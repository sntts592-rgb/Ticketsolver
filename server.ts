import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared DB State
let dbInstance: any = null;
let isFirestoreReady = false;
let dbInitializationError: string | null = null;
let searchDataset: any[] = []; // In-memory fallback / cache

// Structured Error Handling for Firestore
interface FirestoreErrorInfo {
  error: string;
  operationType: string;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: string, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: "system-admin-server",
      email: "system-admin-server@gcp.internal",
      emailVerified: true,
      isAnonymous: false,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Lazy initialized Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.includes("MY_")) {
      console.warn("GEMINI_API_KEY is not configured or contains placeholder value. Semantic embeddings will fall back to textual analysis.");
      return null;
    }
    try {
      geminiClient = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
      console.log("Google Gen AI SDK initialized successfully.");
    } catch (e) {
      console.error("Failed to initialize Google Gen AI client:", e);
    }
  }
  return geminiClient;
}

// Simple in-memory CSV parser helper
function parseSpreadsheetCSV(csvContent: string): any[] {
  const lines = csvContent.split("\n");
  const parsedRows: any[] = [];
  if (lines.length === 0) return [];

  // Parse header
  const headers = lines[0].split(",").map(h => h.trim());
  let count = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle standard CSV parsing with quoted segments
    const fields: string[] = [];
    let currentField = "";
    let insideQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === "," && !insideQuotes) {
        fields.push(currentField.trim());
        currentField = "";
      } else {
        currentField += char;
      }
    }
    fields.push(currentField.trim());

    if (fields.length > 0) {
      count++;
      const rowObj: any = {
        id: count,
        intent: fields[0] || "",
        category: fields[1] || "",
        exampleQueries: fields[2] || "",
        requiredInfo: fields[3] || "",
        troubleshootingSteps: fields[4] || "",
        assignment: fields[5] || "",
        combinedText: "",
        embedding: null,
      };

      // Construct flat search indexing block
      rowObj.combinedText = `Intent: ${rowObj.intent} | Category: ${rowObj.category} | Examples: ${rowObj.exampleQueries} | Core questions: ${rowObj.requiredInfo} | Playbook: ${rowObj.troubleshootingSteps} | Assigned queue: ${rowObj.assignment}`.toLowerCase();
      parsedRows.push(rowObj);
    }
  }
  return parsedRows;
}

// Safe bootstrap Loader for CSV data
const csvFilePath = path.join(__dirname, "tickets_kb.csv");
if (fs.existsSync(csvFilePath)) {
  try {
    const rawCSV = fs.readFileSync(csvFilePath, "utf8");
    searchDataset = parseSpreadsheetCSV(rawCSV);
    console.log(`Loaded ${searchDataset.length} baseline records from tickets_kb.csv`);
  } catch (err) {
    console.error("Error reading csv file:", err);
  }
} else {
  console.warn("tickets_kb.csv database source file not found.");
}

// Initialize Firestore if credentials exist
async function startFirestore() {
  const blueprintConfigPath = path.join(__dirname, "firebase-applet-config.json");
  if (fs.existsSync(blueprintConfigPath)) {
    try {
      const configRaw = fs.readFileSync(blueprintConfigPath, "utf8");
      const firebaseConfig = JSON.parse(configRaw);
      
      let credentialOption: any = null;
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
          credentialOption = admin.credential.cert(serviceAccount);
          console.log("Using explicit FIREBASE_SERVICE_ACCOUNT service account credentials for Firestore.");
        } catch (jsonErr) {
          console.error("FIREBASE_SERVICE_ACCOUNT variable exists but failed to parse as JSON service account key:", jsonErr);
        }
      }

      // Safe bypass if on Vercel style serverless deployment without credentials to prevent standard ADC hangs
      if (process.env.VERCEL && !credentialOption) {
        console.warn("Vercel context detected without explicit service account credentials. Standard ADC (Application Default Credentials) metadata sweeps are bypassed to avoid cold-start service gateway hangs. Operating via high-efficiency local in-memory fallback.");
        dbInitializationError = "Firestore disabled on Vercel: FIREBASE_SERVICE_ACCOUNT environment variable is not configured. Falling back to local in-memory dataset.";
        return;
      }

      admin.initializeApp({
        projectId: firebaseConfig.projectId,
        ...(credentialOption ? { credential: credentialOption } : {}),
      });

      // Handle custom databaseId with fallback to default database
      let customDbSelected = false;
      if (firebaseConfig.firestoreDatabaseId) {
        try {
          dbInstance = admin.firestore(firebaseConfig.firestoreDatabaseId);
          customDbSelected = true;
        } catch (dbIdErr) {
          console.warn("Could not load custom Firestore databaseId directly:", dbIdErr);
        }
      }

      if (!dbInstance) {
        dbInstance = admin.firestore();
        customDbSelected = false;
      }

      // Verify connection and fallback if custom database doesn't exist/isn't provisioned yet
      let snap;
      try {
        console.log(`Testing connection to active Firestore database (${customDbSelected ? firebaseConfig.firestoreDatabaseId : "default"})...`);
        const getPromise = dbInstance.collection("tickets_kb").get();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore connection timed out after 5000ms")), 5000));
        snap = await Promise.race([getPromise, timeoutPromise]) as any;
        isFirestoreReady = true;
        console.log("Connected to Cloud Firestore.");
      } catch (getErr: any) {
        const errMsg = getErr?.message || String(getErr);
        if (customDbSelected && (errMsg.includes("NOT_FOUND") || errMsg.includes("5") || getErr?.code === 5)) {
          console.warn(`Firestore Database ID '${firebaseConfig.firestoreDatabaseId}' not found (5 NOT_FOUND). Falling back to standard '(default)' database...`);
          try {
            dbInstance = admin.firestore();
            const fallbackPromise = dbInstance.collection("tickets_kb").get();
            const fallbackTimeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore connection timed out after 5000ms")), 5000));
            snap = await Promise.race([fallbackPromise, fallbackTimeoutPromise]) as any;
            isFirestoreReady = true;
            console.log("Fallback sequence complete. Connected successfully to the (default) Firestore database.");
          } catch (fallbackErr) {
            handleFirestoreError(fallbackErr, "list", "tickets_kb");
          }
        } else {
          handleFirestoreError(getErr, "list", "tickets_kb");
        }
      }

      if (isFirestoreReady && snap) {
        if (snap.empty) {
          console.log("Firestore collection 'tickets_kb' is currently empty. Executing baseline cloud seeding...");
          // Seed first 50 entries to keep startup instantaneous (Zero quota hit, user can load more interactively)
          const partialSeed = searchDataset.slice(0, 50);
          for (const item of partialSeed) {
            const docId = `kb_${item.id}`;
            try {
              await dbInstance.collection("tickets_kb").doc(docId).set(item);
            } catch (setErr) {
              handleFirestoreError(setErr, "create", `tickets_kb/${docId}`);
            }
          }
          console.log(`Seeded first ${partialSeed.length} baseline records directly to cloud Firestore. Ready for index expansions.`);
        } else {
          // Hydrate searchDataset with the stored values in Firestore
          const fbRecords: any[] = [];
          snap.forEach((d: any) => {
            fbRecords.push(d.data());
          });
          if (fbRecords.length > 0) {
            // Re-sort hydrated search records
            fbRecords.sort((a, b) => (a.id || 0) - (b.id || 0));
            // Merge / replace search dataset with active firestore database content
            searchDataset = fbRecords;
            console.log(`Successfully hydrated and synchronized ${searchDataset.length} live records from Cloud Firestore.`);
          }
        }
      }
    } catch (e: any) {
      dbInitializationError = e.message || String(e);
      console.error("Failed to bootstrap Firestore database:", e);
    }
  } else {
    console.log("Firestore setup not detected. Starting in high-performance local spreadsheet fallback mode.");
  }
}

// Vector Cosine Similarity
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProd = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProd += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProd / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

// Simple text-intersection fallback algorithm for simulation model
function calculateTextIntersectionScore(text: string, query: string): number {
  const textWords = new Set(text.toLowerCase().split(/[\s,./?#_!|-]+/));
  const queryWords = query.toLowerCase().split(/[\s,./?#_!|-]+/);
  if (queryWords.length === 0) return 0;
  let hits = 0;
  queryWords.forEach(w => {
    if (w.length > 2 && textWords.has(w)) {
      hits += 1;
    }
  });
  return hits / queryWords.length;
}

const app = express();
export { app };

app.use(express.json({ limit: "15mb" }));

// Boot up Firestore in the background in a non-blocking fashion
startFirestore().catch(e => {
  console.error("Non-blocking background startFirestore failed:", e);
});

  // API Route - System Status Info
  app.get("/api/status", (req, res) => {
    const ai = getGeminiClient();
    res.json({
      activeDatabase: isFirestoreReady ? "Cloud Firestore (Spark Sync enabled)" : "InMemory Vector Fallback (Local CSV rules)",
      databaseSize: searchDataset.length,
      embeddedCount: searchDataset.filter(item => item.embedding && item.embedding.length > 0).length,
      hasGeminiApiKey: ai !== null,
      dbError: dbInitializationError,
    });
  });

  // API Route - Paginated Database Fetch
  app.get("/api/kb", (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 15;
      const search = (req.query.search as string || "").toLowerCase();
      const category = req.query.category as string || "All";
      const queue = req.query.queue as string || "All";

      let filtered = [...searchDataset];

      if (category && category !== "All") {
        filtered = filtered.filter(item => item.category === category);
      }
      if (queue && queue !== "All") {
        filtered = filtered.filter(item => item.assignment === queue);
      }
      if (search) {
        filtered = filtered.filter(item => 
          item.intent.toLowerCase().includes(search) ||
          item.category.toLowerCase().includes(search) ||
          item.exampleQueries.toLowerCase().includes(search) ||
          item.assignment.toLowerCase().includes(search) ||
          (item.troubleshootingSteps || "").toLowerCase().includes(search)
        );
      }

      const totalItems = filtered.length;
      const startIndex = (page - 1) * limit;
      const paginatedItems = filtered.slice(startIndex, startIndex + limit);

      res.json({
        page,
        limit,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
        items: paginatedItems
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // API Route - Create Single Record
  app.post("/api/kb", async (req, res) => {
    try {
      const record = req.body;
      if (!record.intent || !record.category || !record.assignment) {
        return res.status(400).json({ error: "Missing required properties: intent, category, and assignment are mandatory." });
      }

      // Automatically construct indexing text block
      const compound = `Intent: ${record.intent} | Category: ${record.category} | Examples: ${record.exampleQueries || ""} | Core questions: ${record.requiredInfo || ""} | Playbook: ${record.troubleshootingSteps || ""} | Assigned queue: ${record.assignment}`.toLowerCase();
      
      const newId = searchDataset.length > 0 ? Math.max(...searchDataset.map(r => r.id)) + 1 : 1;
      
      const completeRecord: any = {
        id: newId,
        intent: record.intent,
        category: record.category,
        exampleQueries: record.exampleQueries || "",
        requiredInfo: record.requiredInfo || "",
        troubleshootingSteps: record.troubleshootingSteps || "",
        assignment: record.assignment,
        combinedText: compound,
        embedding: null,
      };

      // Try generating embedding if Gemini API key exists
      const ai = getGeminiClient();
      if (ai) {
        try {
          const embRes: any = await ai.models.embedContent({
            model: "gemini-embedding-2-preview",
            contents: compound,
          });
          if (embRes.embedding && embRes.embedding.values) {
            completeRecord.embedding = embRes.embedding.values;
            console.log(`Generated embedding vector (${completeRecord.embedding.length} values) for intent: ${completeRecord.intent}`);
          }
        } catch (embErr) {
          console.error("Deferred non-blocking write-time embedding fail:", embErr);
        }
      }

      // Save to memory cache
      searchDataset.push(completeRecord);

      // If Firestore, sync
      if (isFirestoreReady && dbInstance) {
        const docId = `kb_${newId}`;
        try {
          await dbInstance.collection("tickets_kb").doc(docId).set(completeRecord);
        } catch (err) {
          handleFirestoreError(err, "create", `tickets_kb/${docId}`);
        }
      }

      res.status(201).json(completeRecord);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // API Route - Update Existing Record
  app.put("/api/kb/:id", async (req, res) => {
    try {
      const kbId = parseInt(req.params.id);
      const updatedFields = req.body;

      const idx = searchDataset.findIndex(r => r.id === kbId);
      if (idx === -1) {
        return res.status(404).json({ error: "KB Record not found." });
      }

      const existingRecord = searchDataset[idx];
      const mergedRecord = {
        ...existingRecord,
        ...updatedFields,
        id: kbId, // preserve index ID immutable
      };

      // Re-calculate the unified search block text
      mergedRecord.combinedText = `Intent: ${mergedRecord.intent} | Category: ${mergedRecord.category} | Examples: ${mergedRecord.exampleQueries} | Core questions: ${mergedRecord.requiredInfo} | Playbook: ${mergedRecord.troubleshootingSteps} | Assigned queue: ${mergedRecord.assignment}`.toLowerCase();

      // Check if text changed to generate a new embedding
      if (mergedRecord.combinedText !== existingRecord.combinedText) {
        const ai = getGeminiClient();
        if (ai) {
          try {
            const embRes: any = await ai.models.embedContent({
              model: "gemini-embedding-2-preview",
              contents: mergedRecord.combinedText,
            });
            if (embRes.embedding && embRes.embedding.values) {
              mergedRecord.embedding = embRes.embedding.values;
              console.log(`Updated embedding vector for intent: ${mergedRecord.intent}`);
            }
          } catch (embErr) {
            console.error("Non-blocking update embedding generation fail:", embErr);
          }
        }
      }

      // Put to memory
      searchDataset[idx] = mergedRecord;

      // Sync to Firebase
      if (isFirestoreReady && dbInstance) {
        const docId = `kb_${kbId}`;
        try {
          await dbInstance.collection("tickets_kb").doc(docId).set(mergedRecord);
        } catch (err) {
          handleFirestoreError(err, "update", `tickets_kb/${docId}`);
        }
      }

      res.json(mergedRecord);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // API Route - Delete Record
  app.delete("/api/kb/:id", async (req, res) => {
    try {
      const kbId = parseInt(req.params.id);
      const idx = searchDataset.findIndex(r => r.id === kbId);
      if (idx === -1) {
        return res.status(404).json({ error: "KB Record not found." });
      }

      searchDataset.splice(idx, 1);

      if (isFirestoreReady && dbInstance) {
        const docId = `kb_${kbId}`;
        try {
          await dbInstance.collection("tickets_kb").doc(docId).delete();
        } catch (err) {
          handleFirestoreError(err, "delete", `tickets_kb/${docId}`);
        }
      }

      res.json({ success: true, message: `KB Record ${kbId} deleted.` });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // API Route - Heavy Seeding Action (Zero Quota Loss / Interactive)
  app.post("/api/kb/seed-all", async (req, res) => {
    try {
      if (!isFirestoreReady || !dbInstance) {
        return res.status(400).json({ error: "Cloud database configuration is absent. Connect Firestore to execute remote syncing." });
      }

      console.log(`Starting cloud migration of all ${searchDataset.length} baseline records to Firestore...`);
      // Run bulk sequential sets
      let syncedCount = 0;
      for (const item of searchDataset) {
        const docId = `kb_${item.id}`;
        try {
          await dbInstance.collection("tickets_kb").doc(docId).set(item);
        } catch (err) {
          handleFirestoreError(err, "write", `tickets_kb/${docId}`);
        }
        syncedCount++;
      }

      res.json({ success: true, message: `Successfully synchronized and indexed ${syncedCount} unique records inside Cloud Firestore Studio.` });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // API Route - Generate Single Vector Embedding (Enables live testing of semantic search on individual items)
  app.post("/api/kb/vectorize/:id", async (req, res) => {
    try {
      const kbId = parseInt(req.params.id);
      const record = searchDataset.find(r => r.id === kbId);
      if (!record) {
        return res.status(404).json({ error: "KB Record not found." });
      }

      const ai = getGeminiClient();
      if (!ai) {
        return res.status(400).json({ error: "Gemini API key is not configured in Secrets dashboard. Vectorization disabled." });
      }

      const txt = record.combinedText || `Intent: ${record.intent} | Category: ${record.category}`;
      const embRes: any = await ai.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: txt,
      });

      if (embRes.embedding && embRes.embedding.values) {
        record.embedding = embRes.embedding.values;
        
        // Sync back to db
        if (isFirestoreReady && dbInstance) {
          const docId = `kb_${kbId}`;
          try {
            await dbInstance.collection("tickets_kb").doc(docId).set(record);
          } catch (err) {
            handleFirestoreError(err, "update", `tickets_kb/${docId}`);
          }
        }
        res.json({ success: true, record });
      } else {
        res.status(500).json({ error: "Embedding API succeeded but returned empty vector values." });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // API Route - Batch Vectorization Trigger (Sequential with feedback)
  app.post("/api/kb/vectorize-next-batch", async (req, res) => {
    try {
      const ai = getGeminiClient();
      if (!ai) {
        return res.status(400).json({ error: "Gemini API key is not configured in Secrets dashboard." });
      }

      // Find up to 10 un-embedded records to process
      const targetItems = searchDataset.filter(item => !item.embedding || item.embedding.length === 0).slice(0, 5);
      
      if (targetItems.length === 0) {
        return res.json({ success: true, processed: 0, message: "All local records fully vectorized!" });
      }

      let count = 0;
      for (const item of targetItems) {
        try {
          const txt = item.combinedText || `Intent: ${item.intent} | Category: ${item.category}`;
          const embRes: any = await ai.models.embedContent({
            model: "gemini-embedding-2-preview",
            contents: txt,
          });
          if (embRes.embedding && embRes.embedding.values) {
            item.embedding = embRes.embedding.values;
            count++;
            
            // Save
            if (isFirestoreReady && dbInstance) {
              const docId = `kb_${item.id}`;
              try {
                await dbInstance.collection("tickets_kb").doc(docId).set(item);
              } catch (err) {
                handleFirestoreError(err, "update", `tickets_kb/${docId}`);
              }
            }
          }
        } catch (innerErr) {
          console.error(`Error embedding item ${item.id}:`, innerErr);
          // break out or continue to prevent complete failure of batch
        }
      }

      res.json({
        success: true,
        processed: count,
        message: `Vectorized ${count} database rules in current thread.`,
        remaining: searchDataset.filter(item => !item.embedding || item.embedding.length === 0).length
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // API Route - Dynamic Intelligent Router & Analyzer
  app.post("/api/route", async (req, res) => {
    try {
      const { description } = req.body;
      if (!description || description.trim().length === 0) {
        return res.status(400).json({ error: "Description string is mandatory to perform cognitive ticket dispatching." });
      }

      let searchEmbedding: number[] | null = null;
      let usedVectorAPI = false;

      // Try Generating Embedding with Gemini
      const ai = getGeminiClient();
      if (ai) {
        try {
          const embRes: any = await ai.models.embedContent({
            model: "gemini-embedding-2-preview",
            contents: description.toLowerCase(),
          });
          if (embRes.embedding && embRes.embedding.values) {
            searchEmbedding = embRes.embedding.values;
            usedVectorAPI = true;
          }
        } catch (innerEmbErr) {
          console.warn("Embedding generation failed in dispatch stream. Falling back to textual analytics:", innerEmbErr);
        }
      }

      interface ScoringMatch {
        record: any;
        score: number;
        similarityPercentage: number;
      }

      let scoredMatches: ScoringMatch[] = [];

      // Calculate matches
      if (searchEmbedding && usedVectorAPI) {
        // High fidelity Vector Cosine Comparison
        scoredMatches = searchDataset
          .filter(item => item.embedding && item.embedding.length > 0)
          .map(item => {
            const similarity = cosineSimilarity(searchEmbedding!, item.embedding);
            return {
              record: item,
              score: similarity,
              similarityPercentage: Math.round(similarity * 100),
            };
          });

        // Sort descending
        scoredMatches.sort((a, b) => b.score - a.score);
      }

      // If we got no matches because of absent vectors, run flat token text comparison fallback
      if (scoredMatches.length === 0 || scoredMatches[0].score < 0.2) {
        const textMatches = searchDataset.map(item => {
          const score = calculateTextIntersectionScore(item.combinedText, description);
          return {
            record: item,
            score: score,
            similarityPercentage: Math.round(score * 100)
          };
        });
        textMatches.sort((a, b) => b.score - a.score);
        // Combine or override
        scoredMatches = textMatches;
      }

      // Safe Top Matches slicing (Max 3)
      const topMatches = scoredMatches.slice(0, 3);
      
      // Select the primary winning assignment
      let suggestedAssignment = "ITC - Service Desk (General Queue)";
      let suggestedCategory = "General Support";
      let troubleshootingSteps = "1. Confirm issue details\n2. Replicate incident details\n3. Route to dedicated platform team";
      let requiredInfo = "User's workstation, exact error timestamp, site location";
      let matchIntent = "unmatched_default";

      if (topMatches.length > 0 && topMatches[0].score > 0) {
        const winner = topMatches[0].record;
        suggestedAssignment = winner.assignment;
        suggestedCategory = winner.category;
        troubleshootingSteps = winner.troubleshootingSteps;
        requiredInfo = winner.requiredInfo;
        matchIntent = winner.intent;
      }

      // Use a fast summary text synthesis explanation from Gemini Flash with Search Grounding if key is present
      let routingJustification = "Calculated optimal dispatch endpoint by matching ticket description tokens directly against the technical documentation keywords.";
      let groundedKeyPoints: any = null;

      if (ai) {
        try {
          const groundingPrompt = `
You are an expert IT Solutions Architect and Lead Dispatch Specialist.
We received an IT support ticket:
Description: "${description}"

We found a matched database support rule in our technical catalog:
Intent Match: "${matchIntent}"
Category: "${suggestedCategory}"
Team Assignment: "${suggestedAssignment}"
Existing Playbook: "${troubleshootingSteps}"
Existing Required Info Checklist: "${requiredInfo}"

Please analyze this ticket with highest precision.
Integrate your Google Search grounding tool to search the web and resolve additional external context (e.g. system protocols, known standard solutions, exact error guidelines, best practices, executable details, or specifics of technologies mentioned like 'Sentinel', 'TPnet.exe', AD domain, cloud resource limits, etc.). Ensure all insights are highly accurate, robust, and state-of-the-art.

You must reply with a valid JSON object matching the following structure:
{
  "cognitiveJustification": "A casual, professional 1-sentence summary (under 30 words) explaining why this ticket maps to Intent: '${matchIntent}', Category: '${suggestedCategory}', and Team Queue: '${suggestedAssignment}'. Mention the primary system focus.",
  "groundedKeyPoints": {
    "summary": "High-level visual storytelling breakdown of the issue (2-3 short sentences), resolving jargon and standard tech context.",
    "keyPoints": [
      {
        "title": "Short bold title (e.g., Security Quarantine Alert, Endpoint Executable)",
        "description": "Clear context-rich explanation of this key aspect (incorporating web research details).",
        "type": "critical"|"warning"|"info"|"success"
      },
      ... generate at least 3-4 highly relevant points
    ],
    "extendedPlaybook": [
      "Step 1: Detailed action...",
      "Step 2: Detailed action...",
      ... generate 4-5 actionable highly accurate steps
    ],
    "verifiedIngredients": [
      "Gathering requirement 1...",
      "Gathering requirement 2..."
    ]
  }
}

Do NOT wrap inside multiple objects. Verify validity of JSON. Do not write any conversational text other than the JSON object itself. Make sure JSON contains exactly the requested fields. Double-check closing braces.
`;

          const textRes = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: groundingPrompt,
            config: {
              tools: [{ googleSearch: {} }],
              responseMimeType: "application/json"
            }
          });

          if (textRes.text) {
            try {
              let cleanedText = textRes.text.trim();
              if (cleanedText.startsWith("```")) {
                cleanedText = cleanedText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
              }
              const parsed = JSON.parse(cleanedText);
              if (parsed.cognitiveJustification) {
                routingJustification = parsed.cognitiveJustification;
              }
              if (parsed.groundedKeyPoints) {
                groundedKeyPoints = parsed.groundedKeyPoints;
                
                // Add grounding sources from metadata if available!
                const groundingSources: any[] = [];
                const chunks = textRes.candidates?.[0]?.groundingMetadata?.groundingChunks;
                if (chunks && Array.isArray(chunks)) {
                  chunks.forEach((chunk: any) => {
                    if (chunk.web?.uri) {
                      groundingSources.push({
                        title: chunk.web.title || "Official Reference Documentation",
                        url: chunk.web.uri
                      });
                    }
                  });
                }
                
                // Filter unique sources by URL
                const uniqueSources = groundingSources.filter(
                  (value, index, self) => self.findIndex(t => t.url === value.url) === index
                );
                
                groundedKeyPoints.groundingSources = uniqueSources;
              }
            } catch (jsonErr) {
              console.error("Failed to parse grounding JSON content:", jsonErr, textRes.text);
            }
          }
        } catch (summaryErr) {
          console.error("Justification & Grounding synthesis fail:", summaryErr);
        }
      }

      if (!groundedKeyPoints) {
        // High fidelity visual-fallback key points derived locally
        const localSteps = troubleshootingSteps ? troubleshootingSteps.split(/[\n\r?]+/)
          .map(s => s.replace(/^\d+[\.\-\s]*/, "").trim())
          .filter(Boolean) : [];
        const localIngredients = requiredInfo ? requiredInfo.split(/[,|?]+/)
          .map(s => s.trim())
          .filter(Boolean) : [];

        groundedKeyPoints = {
          summary: `Identified standard administrative support request mapping directly to our ${suggestedCategory} playbook.`,
          keyPoints: [
            {
              title: "Incident Class",
              description: `This request belongs to the standard '${suggestedCategory}' class within our database matrix.`,
              type: "info"
            },
            {
              title: "Verification Requirements",
              description: `Must confirm and collect user environmental variables: ${requiredInfo || "standard client workstation specifications"}.`,
              type: "warning"
            },
            {
              title: "Baseline Protocol",
              description: "Utilize standard troubleshooting workflows to test connection gateways or permissions.",
              type: "success"
            }
          ],
          extendedPlaybook: localSteps.length > 0 ? localSteps : ["Verify error details", "Attempt sandbox reproduction", "Route to appropriate support level"],
          verifiedIngredients: localIngredients.length > 0 ? localIngredients : ["Workstation hostname", "Error timestamp", "Admin access approval"],
          groundingSources: [
            { title: "Standard Dispatch Registry", url: "#" }
          ]
        };
      }

      res.json({
        ticketDescription: description,
        assignedQueue: suggestedAssignment,
        category: suggestedCategory,
        primaryIntent: matchIntent,
        cognitiveJustification: routingJustification,
        requiredInfo: requiredInfo,
        remediationPlaybook: troubleshootingSteps,
        matchingConfidence: topMatches.length > 0 ? topMatches[0].similarityPercentage : 0,
        searchMethodUsed: usedVectorAPI ? "High-Accuracy Gemini Cognitive Embedding (k-NN Match)" : "Spreadsheet Token Keyword Matching",
        groundedKeyPoints: groundedKeyPoints,
        topMatches: topMatches.map(m => ({
          intent: m.record.intent,
          category: m.record.category,
          assignment: m.record.assignment,
          queries: m.record.exampleQueries,
          score: m.similarityPercentage,
          requiredInfo: m.record.requiredInfo || "",
          troubleshootingSteps: m.record.troubleshootingSteps || ""
        }))
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

// Handle Vite middleware & fallback listening wrapping
async function startListener() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
    const PORT = 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server launched on port ${PORT}`);
    });
  }
}

startListener().catch(err => {
  console.error("Failed to bootstrap live startListener:", err);
});
