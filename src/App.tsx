import React, { useState, useEffect } from "react";
import { 
  motion, 
  AnimatePresence 
} from "motion/react";
import { 
  Cpu, 
  Database, 
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  CheckCircle, 
  ChevronRight, 
  ChevronLeft, 
  AlertCircle, 
  RefreshCcw, 
  Play, 
  Layers, 
  CheckSquare, 
  Sparkles, 
  ExternalLink,
  BookOpen,
  Filter,
  X,
  MapPin,
  ClipboardList,
  Wrench,
  HelpCircle,
  Sun,
  Moon
} from "lucide-react";

// Types corresponding to Backend API schemas
interface SystemStats {
  activeDatabase: string;
  databaseSize: number;
  embeddedCount: number;
  hasGeminiApiKey: boolean;
  dbError: string | null;
}

interface KBItem {
  id: number;
  intent: string;
  category: string;
  exampleQueries: string;
  requiredInfo: string;
  troubleshootingSteps: string;
  assignment: string;
  combinedText?: string;
  embedding?: number[] | null;
}

interface MatchDetail {
  intent: string;
  category: string;
  assignment: string;
  queries: string;
  score: number;
  requiredInfo?: string;
  troubleshootingSteps?: string;
}

interface GroundedKeyPoints {
  summary: string;
  keyPoints: {
    title: string;
    description: string;
    type: "critical" | "warning" | "info" | "success" | string;
  }[];
  extendedPlaybook: string[];
  verifiedIngredients: string[];
  groundingSources?: {
    title: string;
    url: string;
  }[];
}

interface AnalysisResult {
  ticketDescription: string;
  assignedQueue: string;
  category: string;
  primaryIntent: string;
  cognitiveJustification: string;
  requiredInfo: string;
  remediationPlaybook: string;
  matchingConfidence: number;
  searchMethodUsed: string;
  topMatches: MatchDetail[];
  groundedKeyPoints?: GroundedKeyPoints | null;
}

export default function App() {
  // System context states
  const [stats, setStats] = useState<SystemStats>({
    activeDatabase: "Loading system registry...",
    databaseSize: 0,
    embeddedCount: 0,
    hasGeminiApiKey: false,
    dbError: null,
  });

  const [loadingStats, setLoadingStats] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [vectorizingBatch, setVectorizingBatch] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);

  // Theme support
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem("dispatchKB_darkMode");
    return saved !== null ? saved === "true" : true;
  });

  const toggleDarkMode = () => {
    setDarkMode(prev => {
      localStorage.setItem("dispatchKB_darkMode", (!prev).toString());
      return !prev;
    });
  };

  // Router sandbox states
  const [ticketInput, setTicketInput] = useState("");
  const [isRouting, setIsRouting] = useState(false);
  const [routeResult, setRouteResult] = useState<AnalysisResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  const [checklistState, setChecklistState] = useState<{ [key: string]: boolean }>({});
  const [activeResultsTab, setActiveResultsTab] = useState<"points" | "playbook" | "overview" | "sources">("points");

  const activeMatch = routeResult ? {
    assignedQueue: routeResult.topMatches[selectedMatchIndex]?.assignment || routeResult.assignedQueue,
    category: routeResult.topMatches[selectedMatchIndex]?.category || routeResult.category,
    matchingConfidence: routeResult.topMatches[selectedMatchIndex]?.score ?? routeResult.matchingConfidence,
    requiredInfo: routeResult.topMatches[selectedMatchIndex]?.requiredInfo ?? routeResult.requiredInfo,
    remediationPlaybook: routeResult.topMatches[selectedMatchIndex]?.troubleshootingSteps ?? routeResult.remediationPlaybook,
    intent: routeResult.topMatches[selectedMatchIndex]?.intent || routeResult.primaryIntent,
  } : null;

  // Sync checklist state dynamically with active match selection or grounded verifiedIngredients
  useEffect(() => {
    if (activeMatch) {
      const checklistObj: { [key: string]: boolean } = {};
      
      // If we are looking at the main prediction (Option #1) and have advanced live-grounded requirements, use them
      if (selectedMatchIndex === 0 && routeResult?.groundedKeyPoints?.verifiedIngredients) {
        routeResult.groundedKeyPoints.verifiedIngredients.forEach(item => {
          if (item.trim()) {
            checklistObj[item.trim()] = false;
          }
        });
      } else {
        const splits = activeMatch.requiredInfo.split(/[,?|]+/);
        splits.forEach(s => {
          if (s.trim()) {
            checklistObj[s.trim()] = false;
          }
        });
      }
      setChecklistState(checklistObj);
      
      // Auto switch tabs on routing results change to points if available
      if (routeResult?.groundedKeyPoints) {
        setActiveResultsTab("points");
      }
    }
  }, [selectedMatchIndex, routeResult]);

  // KB rules database grid states
  const [kbItems, setKbItems] = useState<KBItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [queueFilter, setQueueFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loadingKB, setLoadingKB] = useState(true);

  // Interactive Modal / Editor state
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [selectedKBId, setSelectedKBId] = useState<number | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [savingRecord, setSavingRecord] = useState(false);

  // Editor Form Fields State
  const [formIntent, setFormIntent] = useState("");
  const [formCategory, setFormCategory] = useState("Network");
  const [formAssignment, setFormAssignment] = useState("ITC - Network");
  const [formQueries, setFormQueries] = useState("");
  const [formRequiredInfo, setFormRequiredInfo] = useState("");
  const [formSteps, setFormSteps] = useState("");

  // Categories helper lists parsed from spreadsheet baseline
  const categoriesList = [
    "Network", "Messaging", "AD/Messaging", "Wintel", 
    "Asset Management", "Azure", "Endpoint Security", 
    "Firewall / Security", "Internet Access", "Network Security", 
    "Service Account", "Web Access", "SCCM", "Software Support"
  ];

  const queuesList = [
    "ITC - Network", "Messaging Team", "Messaging", "Wintel", 
    "Asset Team", "Azure Team", "ITC - Cyber Security", 
    "SCCM Team", "SD Team"
  ];

  // System preset templates for live prompt testing
  const promptPresets = [
    {
      title: "Guest WiFi Fail",
      text: "Our studio guest wifi access code is failing when customer tries to log in, says expired ticket.",
      icon: MapPin
    },
    {
      title: "High CPU Alert",
      text: "Wintel CPU threshold exceeded on backup service host VUK629, currently running at 98% utilization.",
      icon: Cpu
    },
    {
      title: "Shared Mailbox Grant",
      text: "Request access permissions for newly onboarded accountant John to read the shared EMEA AP ledger mailbox.",
      icon: BookOpen
    },
    {
      title: "Bitwarden GPO Update",
      text: "Azure Active Directory request to amend GPO settings for Chrome to push the latest Bitwarden enterprise extension.",
      icon: Layers
    },
    {
      title: "Sentinel AV Threat",
      text: "Sentinel popup threat quarantine triggered for TPnet.exe in industrial site shopfloor workstation A612.",
      icon: AlertCircle
    }
  ];

  // Fetch Core statistics
  const fetchStatus = async () => {
    try {
      setLoadingStats(true);
      const res = await fetch("/api/status");
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error("Failed to query status api", e);
    } finally {
      setLoadingStats(false);
    }
  };

  // Fetch Paginated KB Records
  const fetchKB = async () => {
    try {
      setLoadingKB(true);
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: "15",
        search: searchQuery,
        category: categoryFilter,
        queue: queueFilter
      });
      const res = await fetch(`/api/kb?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setKbItems(data.items);
        setTotalPages(data.totalPages);
        setTotalItems(data.totalItems);
      }
    } catch (error) {
      console.error("Failed to read kb database rules", error);
    } finally {
      setLoadingKB(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    fetchKB();
  }, [currentPage, searchQuery, categoryFilter, queueFilter]);

  // Execute Dispatch Routing Prediction
  const handleIntelligentRoute = async (customText?: string) => {
    const textToAnalyze = customText || ticketInput;
    if (!textToAnalyze.trim()) {
      setRouteError("Ticket description input is empty! Please supply a description first.");
      return;
    }
    try {
      setIsRouting(true);
      setRouteError(null);
      setRouteResult(null);
      setSelectedMatchIndex(0);
      setChecklistState({});

      const response = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: textToAnalyze }),
      });

      if (response.ok) {
        const analysis: AnalysisResult = await response.json();
        setRouteResult(analysis);
      } else {
        const err = await response.json();
        setRouteError(err.error || "Failed to process dispatcher stream.");
      }
    } catch (e: any) {
      setRouteError(e.message || String(e));
    } finally {
      setIsRouting(false);
    }
  };

  // Run instant database record simulation inside the sandbox matching queries
  const handleSimulateRuleText = (item: KBItem) => {
    const queries = item.exampleQueries ? item.exampleQueries.split(/[,;\n]+/).map(q => q.trim()).filter(Boolean) : [];
    const textToSet = queries[0] || `Intent context match query: ${item.intent}`;
    setTicketInput(textToSet);
    
    // Smooth scroll to the top Playground playground area
    const sandboxEl = document.getElementById("dispatch-sandbox");
    if (sandboxEl) {
      sandboxEl.scrollIntoView({ behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    
    // Auto prediction route trigger
    handleIntelligentRoute(textToSet);
  };

  // Trigger Entire Excel CSV Migration Seeding
  const handleFirebaseSyncAll = async () => {
    try {
      setSyncingAll(true);
      const response = await fetch("/api/kb/seed-all", { method: "POST" });
      if (response.ok) {
        const resData = await response.json();
        alert(resData.message || "Seeding complete!");
        fetchStatus();
        fetchKB();
      } else {
        alert("Syncing failed.");
      }
    } catch (e: any) {
      alert("Error executing bulk syncing: " + e.message);
    } finally {
      setSyncingAll(false);
    }
  };

  // Run Sequential Vectorizer Batch
  const handleVectorizeNext = async () => {
    try {
      setVectorizingBatch(true);
      const res = await fetch("/api/kb/vectorize-next-batch", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setBatchResult(`Processed: +${data.processed} | Remaining: ${data.remaining || 0} un-vectorized rules.`);
        fetchStatus();
        fetchKB();
      } else {
        setBatchResult("Error: " + data.error);
      }
    } catch (err: any) {
      setBatchResult("Failure: " + err.message);
    } finally {
      setVectorizingBatch(false);
    }
  };

  // Run Individual Embedding Generator
  const handleVectorizeItem = async (id: number) => {
    try {
      const res = await fetch(`/api/kb/vectorize/${id}`, { method: "POST" });
      if (res.ok) {
        fetchStatus();
        fetchKB();
      } else {
        const err = await res.json();
        alert("Embedding failed: " + err.error);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Delete KB rule
  const handleDeleteKB = async (id: number) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;
    try {
      const res = await fetch(`/api/kb/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchStatus();
        fetchKB();
      }
    } catch (err: any) {
      alert("Delete failed: " + err.message);
    }
  };

  // Open Edit Mode or New Rule Modal
  const openModalForNew = () => {
    setIsEditingMode(false);
    setSelectedKBId(null);
    setFormIntent("");
    setFormCategory("Network");
    setFormAssignment("ITC - Network");
    setFormQueries("");
    setFormRequiredInfo("");
    setFormSteps("");
    setModalError(null);
    setShowEditorModal(true);
  };

  const openModalForEdit = (item: KBItem) => {
    setIsEditingMode(true);
    setSelectedKBId(item.id);
    setFormIntent(item.intent);
    setFormCategory(item.category);
    setFormAssignment(item.assignment);
    setFormQueries(item.exampleQueries);
    setFormRequiredInfo(item.requiredInfo);
    setFormSteps(item.troubleshootingSteps);
    setModalError(null);
    setShowEditorModal(true);
  };

  // Save changes (New or Edit)
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formIntent.trim() || !formCategory.trim() || !formAssignment.trim()) {
      setModalError("Headers for Intent, Category, and Assignment are strict database properties.");
      return;
    }
    try {
      setSavingRecord(true);
      const payload = {
        intent: formIntent,
        category: formCategory,
        assignment: formAssignment,
        exampleQueries: formQueries,
        requiredInfo: formRequiredInfo,
        troubleshootingSteps: formSteps,
      };

      const url = isEditingMode ? `/api/kb/${selectedKBId}` : "/api/kb";
      const method = isEditingMode ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setShowEditorModal(false);
        fetchStatus();
        fetchKB();
      } else {
        const err = await res.json();
        setModalError(err.error || "Save operation failed.");
      }
    } catch (err: any) {
      setModalError(err.message || String(err));
    } finally {
      setSavingRecord(false);
    }
  };

  return (
    <div className={`min-h-screen font-sans flex flex-col overflow-hidden transition-all duration-300 ${darkMode ? "bg-[#050811] text-slate-100" : "bg-slate-100 text-slate-900"}`}>
      
      {/* Top Navigation Bar */}
      <nav className={`h-16 border-b px-6 md:px-8 flex items-center justify-between shadow-xs z-10 shrink-0 ${darkMode ? "bg-[#0b1222]/90 border-[#1e293b]/70" : "bg-white border-slate-210"}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-xs">
            <Cpu className="w-4 h-4 text-white" />
          </div>
          <span className={`font-bold text-lg md:text-xl tracking-tight transition-colors ${darkMode ? "text-slate-100" : "text-slate-800"}`}>IT Dispatch &amp; KB Engine</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleDarkMode}
            className={`p-2 rounded-lg border transition-all cursor-pointer ${
              darkMode 
                ? "bg-[#14213d] border-[#1e293b] text-amber-400 hover:bg-[#1b2b4f]" 
                : "bg-slate-100 border-slate-205 text-slate-600 hover:bg-slate-200/60"
            }`}
            title={darkMode ? "Switch to light workspace" : "Switch to midnight console"}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className={`w-10 h-10 rounded-full border shadow-xs flex items-center justify-center font-bold shrink-0 ${
            darkMode 
              ? "bg-[#14213d] border-[#1e293b] text-slate-205" 
              : "bg-slate-100 border-slate-200 text-slate-700"
          }`} title="sntts592@gmail.com">
            SN
          </div>
        </div>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className={`w-64 border-r p-6 hidden lg:flex flex-col justify-between shrink-0 overflow-y-auto transition-colors ${darkMode ? "bg-[#0b1222] border-[#1e293b] text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">Active Database</p>
              <nav className="space-y-1">
                <a href="#database-registry" className={`flex items-center gap-3 p-2 rounded-lg font-semibold shadow-2xs transition-colors ${darkMode ? "bg-indigo-950/40 text-indigo-300" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"}`}>
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span> tickets_kb
                </a>
              </nav>
            </div>

            <div className="space-y-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">Cloud Architecture</p>
              <nav className="space-y-2">
                <div className={`flex items-center justify-between p-2 text-xs border-b pb-1.5 ${darkMode ? "text-slate-400 border-slate-805/60" : "text-slate-600 border-slate-100"}`}>
                  <span>Gemini Embedding</span>
                  <span className={`text-[10px] font-bold uppercase ${stats.hasGeminiApiKey ? "text-indigo-400" : "text-amber-500"}`}>
                    {stats.hasGeminiApiKey ? "Online" : "Inactive"}
                  </span>
                </div>
                <div className={`flex items-center justify-between p-2 text-xs border-b pb-1.5 ${darkMode ? "text-slate-400 border-slate-805/60" : "text-slate-600 border-slate-100"}`}>
                  <span>Firebase Endpoint</span>
                  <span className={`text-[10px] font-bold uppercase truncate max-w-[90px] ${darkMode ? "text-emerald-450" : "text-green-600"}`} title={stats.activeDatabase}>
                    {stats.activeDatabase.includes("Firestore") ? "Firestore" : "Fallback"}
                  </span>
                </div>
                <div className={`flex items-center justify-between p-2 text-xs border-b pb-1.5 ${darkMode ? "text-slate-400 border-slate-805/60" : "text-slate-600 border-slate-100"}`}>
                  <span>Vector Indexing</span>
                  <span className="text-[10px] text-slate-500 font-bold font-mono">
                    {stats.databaseSize > 0 ? Math.round((stats.embeddedCount / stats.databaseSize) * 100) : 0}%
                  </span>
                </div>
              </nav>
            </div>
          </div>

          <div className={`p-4 border rounded-xl mt-8 shrink-0 transition-all ${darkMode ? "bg-[#0d162d]/50 border-indigo-950/70 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-800"}`}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sync Catalog</p>
            <p className="text-xs font-semibold mt-0.5">Enterprise dataset rules</p>
            <div className={`w-full h-1 rounded-full mt-3 overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-200"}`}>
              <div 
                className="bg-indigo-600 h-full transition-all duration-500" 
                style={{ width: `${stats.databaseSize > 0 ? Math.min(100, Math.round((stats.embeddedCount / stats.databaseSize) * 100)) : 0}%` }}
              />
            </div>
            <p className="text-[10px] mt-2 font-mono text-slate-500">
              {stats.databaseSize} records active
            </p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-6 md:p-8 flex flex-col gap-6 overflow-y-auto">
          {/* Header Section */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className={`text-2xl md:text-3xl font-bold tracking-tight transition-colors ${darkMode ? "text-white" : "text-slate-900"}`}>Knowledge Base Studio</h1>
              <p className={`mt-1 text-xs md:text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                Managing {stats.databaseSize}+ support dispatch vectors configured with active server-side cosine matching.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                id="refresh-center-stats"
                onClick={fetchStatus}
                disabled={loadingStats}
                className={`px-4 py-2 border rounded-lg font-semibold shadow-xs transition-colors text-xs flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  darkMode 
                    ? "bg-[#0f172a] border-[#1e293b] text-slate-350 hover:bg-[#1a2642] hover:text-white" 
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
                title="Synchronize database properties"
              >
                <RefreshCcw className={`w-3.5 h-3.5 ${loadingStats ? "animate-spin text-indigo-500" : ""}`} />
                <span>Refresh Logs</span>
              </button>
              <button 
                onClick={openModalForNew}
                className={`px-4 py-2 rounded-lg font-semibold shadow-xs transition-colors text-xs shrink-0 cursor-pointer ${
                  darkMode 
                    ? "bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white shadow-md shadow-indigo-950/50" 
                    : "bg-slate-900 hover:bg-slate-800 text-white"
                }`}
              >
                New Entry
              </button>
            </div>
          </div>

          {/* System Error Callout */}
          {stats.dbError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-xl flex items-start gap-2.5 text-xs animate-fade-in shadow-2xs shrink-0">
              <AlertCircle className="w-4.5 h-4.5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-900">Cloud Connection Handshake Error</p>
                <p className="font-mono mt-0.5">{stats.dbError}</p>
              </div>
            </div>
          )}

          {/* Dashboard Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
            <div className={`p-5 border rounded-xl shadow-xs transition-all ${darkMode ? "bg-[#0b1120] border-[#1e293b]/70" : "bg-white border-slate-200/80"}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Total Active Rules</p>
              <p className={`text-2xl font-bold mt-1 font-mono ${darkMode ? "text-white" : "text-slate-900"}`}>{stats.databaseSize}</p>
              <p className={`text-[10px] mt-1 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Verified system routing entries</p>
            </div>
            <div className={`p-5 border rounded-xl shadow-xs transition-all ${darkMode ? "bg-[#0b1120] border-[#1e293b]/70" : "bg-white border-slate-200/80"}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>A.I. Vector Indexing Status</p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className={`text-2xl font-bold font-mono ${darkMode ? "text-indigo-400" : "text-indigo-600"}`}>
                  {stats.databaseSize > 0 ? Math.round((stats.embeddedCount / stats.databaseSize) * 100) : 0}%
                </p>
                <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>({stats.embeddedCount} of {stats.databaseSize} indexed)</span>
              </div>
              <p className={`text-[10px] mt-1 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>High-dimensional cosine matrices loaded</p>
            </div>
            <div className={`p-5 border rounded-xl shadow-xs transition-all ${darkMode ? "bg-[#0b1120] border-[#1e293b]/70" : "bg-white border-slate-200/80"}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Active Database Endpoint</p>
              <p className={`text-base font-bold mt-2 truncate font-mono ${darkMode ? "text-slate-300" : "text-slate-800"}`} title={stats.activeDatabase}>
                {stats.activeDatabase.includes("Firestore") ? "Google Cloud Firestore" : "Local Database Fallback"}
              </p>
              <p className={`text-[10px] font-semibold mt-1 ${darkMode ? "text-emerald-400" : "text-emerald-600"}`}>● Active Handshake Established</p>
            </div>
          </div>

          {/* Core Interactive Layout Bento Layer */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start shrink-0">
            
            {/* Sandbox Dispatcher Grid Unit */}
            <div id="dispatch-sandbox" className={`xl:col-span-2 rounded-xl border shadow-xs flex flex-col p-6 space-y-4 ${darkMode ? "bg-[#0b1120] border-[#1e293b]/70" : "bg-white border-slate-200"}`}>
              
              <div className={`flex items-center justify-between border-b pb-3 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <div>
                  <h2 className={`text-sm font-semibold flex items-center gap-1.5 ${darkMode ? "text-slate-100" : "text-slate-950"}`}>
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    Intelligent Routing Terminal (Route Prediction)
                  </h2>
                  <p className={`text-xs mt-0.5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    Provide ticket context or select a baseline template to run predictive semantic classification
                  </p>
                </div>
                <span className={`text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded font-bold border ${darkMode ? "bg-emerald-950/40 border-emerald-800/30 text-emerald-400" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
                  Playground Active
                </span>
              </div>

              {/* Prompt presets */}
              <div className="flex flex-wrap gap-1.5">
                {promptPresets.map((preset, index) => {
                  const Icon = preset.icon;
                  return (
                    <button
                      key={index}
                      onClick={() => {
                        setTicketInput(preset.text);
                        handleIntelligentRoute(preset.text);
                      }}
                      className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition text-left cursor-pointer shadow-3xs ${
                        darkMode 
                          ? "bg-[#141d30] border-[#1e293b] text-slate-300 hover:bg-[#1f2d4a] hover:text-white" 
                          : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-indigo-50/50 hover:border-indigo-200 hover:text-indigo-600"
                      }`}
                    >
                      <Icon className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate max-w-[130px]">{preset.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* Input form */}
              <div className="space-y-2">
                <textarea
                  id="ticket-description-input"
                  name="ticket-description-input"
                  rows={3}
                  placeholder="e.g. Printer is jammed on the 3rd floor office, error code error-09, need support group spool restart"
                  value={ticketInput}
                  onChange={(e) => setTicketInput(e.target.value)}
                  className={`w-full text-xs font-sans p-3 rounded-lg focus:ring-1 focus:outline-none transition ${
                    darkMode 
                      ? "bg-[#090d16] border-[#1e3e6b] focus:border-blue-500 font-mono focus:ring-blue-500/20 text-slate-100 placeholder-slate-550 border-2" 
                      : "bg-slate-50 border-slate-200 focus:border-indigo-500 text-slate-850 placeholder-slate-400 border-1"
                  }`}
                />
                
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-400 italic">
                    * Queries high-dimensional math cosine matches vs Firestore indices
                  </p>
                  <button
                    id="dispatch-button"
                    onClick={() => handleIntelligentRoute()}
                    disabled={isRouting || !ticketInput.trim()}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg pointer-events-auto h-9 transition cursor-pointer ${
                      darkMode 
                        ? "bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white shadow-[0_0_15px_rgba(14,165,233,0.3)] border-transparent" 
                        : "bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-slate-200 disabled:border-transparent cursor-pointer"
                    }`}
                  >
                    <Cpu className={`w-3.5 h-3.5 ${isRouting ? "animate-spin" : ""}`} />
                    {isRouting ? "Analyzing Matrix Coordinates..." : "Analyze & Route Ticket"}
                  </button>
                </div>
              </div>

              {routeError && (
                <div className={`p-3 rounded-lg text-[11px] flex items-center gap-1.5 animate-pulse border ${
                  darkMode ? "bg-rose-950/40 border-rose-900/30 text-rose-350" : "bg-rose-50 border-rose-100 text-rose-700"
                }`}>
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>{routeError}</span>
                </div>
              )}

              {/* Detected Multiple Dispatch Pathways selection */}
              {routeResult && routeResult.topMatches && routeResult.topMatches.length > 0 && (
                <div className={`space-y-2 mt-2 pt-4 border-t ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    Suggested Pathways (Multiple rules candidate matches found)
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {routeResult.topMatches.map((m, idx) => {
                      const isSelected = selectedMatchIndex === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedMatchIndex(idx)}
                          className={`flex flex-col p-3 rounded-lg border text-left transition-all cursor-pointer relative overflow-hidden ${
                            isSelected
                              ? darkMode
                                ? "bg-[#101b33] border-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.25)] text-white"
                                : "bg-indigo-50/70 border-indigo-600 text-slate-900 shadow-3xs"
                              : darkMode
                                ? "bg-[#090e1a]/85 border-slate-800 text-slate-300 hover:bg-[#0e162c] hover:border-slate-700"
                                : "bg-slate-50 border-slate-205 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded uppercase ${
                              isSelected
                                ? "bg-blue-500/20 text-blue-400"
                                : "bg-slate-505/10 text-slate-400"
                            }`}>
                              Option #{idx + 1}
                            </span>
                            <span className={`text-[10px] font-bold font-mono ${isSelected ? "text-emerald-450" : "text-emerald-600"}`}>
                              {m.score}% Acc
                            </span>
                          </div>
                          
                          <p className="text-xs font-bold leading-snug mt-1.5 truncate uppercase tracking-tight">
                            {m.intent}
                          </p>
                          <p className={`text-[10px] truncate mt-1 ${isSelected ? (darkMode ? "text-blue-300" : "text-indigo-600") : "text-slate-400"}`}>
                            Queue: {m.assignment}
                          </p>

                          {isSelected && (
                            <span className="absolute top-0 right-0 w-1 h-full bg-blue-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}              {/* Routed Results Cards inside sandbox */}
              <AnimatePresence mode="wait">
                {routeResult && activeMatch && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.2 }}
                    className={`pt-5 border-t space-y-4 ${darkMode ? "border-slate-800" : "border-slate-150"}`}
                  >
                    {/* Header badge indication */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <p className={`text-xs font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                          Predictive Diagnostic Summary &amp; Grounded Key Points
                        </p>
                      </div>
                      <span className={`text-[10px] font-mono flex items-center gap-1 font-semibold px-2 py-0.5 rounded border uppercase ${
                        darkMode 
                          ? "bg-slate-900/60 border-blue-900/30 text-blue-405" 
                          : "bg-indigo-50 border-indigo-100 text-indigo-700"
                      }`}>
                        <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
                        Grounded via Gemini 3.5 &amp; Google Search API
                      </span>
                    </div>

                    {/* Dynamic Tabs Navigation */}
                    <div className={`flex border-b overflow-x-auto scrollbar-none shrink-0 ${darkMode ? "border-slate-800" : "border-slate-200"}`}>
                      <button
                        type="button"
                        onClick={() => setActiveResultsTab("points")}
                        className={`py-2 px-4 text-xs font-semibold flex items-center gap-1.5 transition-all border-b-2 shrink-0 cursor-pointer ${
                          activeResultsTab === "points"
                            ? darkMode
                              ? "border-blue-500 text-blue-400 bg-blue-950/10 font-bold"
                              : "border-indigo-600 text-indigo-700 font-bold bg-indigo-50/30"
                            : darkMode
                              ? "border-transparent text-slate-400 hover:text-slate-200"
                              : "border-transparent text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Intelligent Key Points</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveResultsTab("playbook")}
                        className={`py-2 px-4 text-xs font-semibold flex items-center gap-1.5 transition-all border-b-2 shrink-0 cursor-pointer ${
                          activeResultsTab === "playbook"
                            ? darkMode
                              ? "border-blue-500 text-blue-400 bg-blue-950/10 font-bold"
                              : "border-indigo-600 text-indigo-700 font-bold bg-indigo-50/30"
                            : darkMode
                              ? "border-transparent text-slate-400 hover:text-slate-200"
                              : "border-transparent text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        <ClipboardList className="w-3.5 h-3.5" />
                        <span>Action Checklist &amp; Playbook</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveResultsTab("overview")}
                        className={`py-2 px-4 text-xs font-semibold flex items-center gap-1.5 transition-all border-b-2 shrink-0 cursor-pointer ${
                          activeResultsTab === "overview"
                            ? darkMode
                              ? "border-blue-500 text-blue-400 bg-blue-950/10 font-bold"
                              : "border-indigo-600 text-indigo-700 font-bold bg-indigo-50/30"
                            : darkMode
                              ? "border-transparent text-slate-400 hover:text-slate-200"
                              : "border-transparent text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Dispatch Coordinates</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveResultsTab("sources")}
                        className={`py-2 px-4 text-xs font-semibold flex items-center gap-1.5 transition-all border-b-2 shrink-0 cursor-pointer ${
                          activeResultsTab === "sources"
                            ? darkMode
                              ? "border-blue-500 text-blue-400 bg-blue-950/10 font-bold"
                              : "border-indigo-600 text-indigo-700 font-bold bg-indigo-50/30"
                            : darkMode
                              ? "border-transparent text-slate-400 hover:text-slate-200"
                              : "border-transparent text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Citations &amp; Sources ({routeResult.groundedKeyPoints?.groundingSources?.length || 0})</span>
                      </button>
                    </div>

                    {/* Tab contents wrapper */}
                    <div className="pt-2">

                      {/* Tab 1: Intelligent Key Points */}
                      {activeResultsTab === "points" && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-4"
                        >
                          {/* Summary sentence */}
                          {routeResult.groundedKeyPoints?.summary && (
                            <div className={`p-4 rounded-xl border text-xs leading-relaxed ${
                              darkMode ? "bg-slate-950/60 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-700"
                            }`}>
                              <span className={`text-[10px] font-mono uppercase font-bold tracking-wider block mb-1.5 ${darkMode ? "text-indigo-400" : "text-indigo-700"}`}>
                                Cognitive Technical Synopsis
                              </span>
                              {routeResult.groundedKeyPoints.summary}
                            </div>
                          )}

                          {/* Key points grid cards */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {routeResult.groundedKeyPoints?.keyPoints && routeResult.groundedKeyPoints.keyPoints.length > 0 ? (
                              routeResult.groundedKeyPoints.keyPoints.map((kp, idx) => {
                                // Decide severity indicator theme
                                let wrapperStyle = "";
                                let accentStyle = "";
                                const typeLower = kp.type?.toLowerCase() || "";

                                if (typeLower.includes("crit") || typeLower.includes("high")) {
                                  wrapperStyle = darkMode 
                                    ? "bg-rose-950/20 border-rose-900/40 text-rose-200 shadow-[inset_0_1px_3px_rgba(244,63,94,0.05)]" 
                                    : "bg-rose-50 border-rose-200 text-rose-950";
                                  accentStyle = "text-rose-500";
                                } else if (typeLower.includes("warn") || typeLower.includes("medium")) {
                                  wrapperStyle = darkMode 
                                    ? "bg-amber-950/20 border-amber-900/40 text-amber-200 shadow-[inset_0_1px_3px_rgba(245,158,11,0.05)]" 
                                    : "bg-amber-50 border-amber-200 text-amber-950";
                                  accentStyle = "text-amber-500";
                                } else if (typeLower.includes("succ") || typeLower.includes("resolve")) {
                                  wrapperStyle = darkMode 
                                    ? "bg-emerald-950/20 border-emerald-900/40 text-emerald-200 shadow-[inset_0_1px_3px_rgba(16,185,129,0.05)]" 
                                    : "bg-emerald-50 border-emerald-250 text-emerald-950";
                                  accentStyle = "text-emerald-500";
                                } else {
                                  wrapperStyle = darkMode 
                                    ? "bg-[#0e162d] border-slate-800 text-blue-200 shadow-[inset_0_1px_3px_rgba(59,130,246,0.05)]" 
                                    : "bg-blue-50 border-blue-200 text-blue-955";
                                  accentStyle = "text-indigo-500";
                                }

                                return (
                                  <motion.div
                                    key={idx}
                                    initial={{ opacity: 0, scale: 0.98 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: idx * 0.05 }}
                                    className={`border rounded-xl p-4 flex flex-col justify-between ${wrapperStyle}`}
                                  >
                                    <div>
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <AlertCircle className={`w-4 h-4 shrink-0 ${accentStyle}`} />
                                        <h4 className="text-xs font-bold uppercase tracking-tight font-sans">
                                          {kp.title}
                                        </h4>
                                      </div>
                                      <p className="text-[11px] leading-relaxed opacity-90 font-sans">
                                        {kp.description}
                                      </p>
                                    </div>
                                    <div className="mt-3 pt-2 border-t border-current/10 flex items-center justify-between text-[9px] uppercase font-mono opacity-60">
                                      <span>Security assessment node</span>
                                      <span className="font-bold">{kp.type}</span>
                                    </div>
                                  </motion.div>
                                );
                              })
                            ) : (
                              <div className="col-span-2 text-center text-slate-405 py-6 italic text-xs">
                                No specific diagnostic key points are available for this analysis.
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}

                      {/* Tab 2: Enriched Action Checklist & Playbook flow */}
                      {activeResultsTab === "playbook" && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="grid grid-cols-1 md:grid-cols-2 gap-4"
                        >
                          {/* Gathering Checklist unit */}
                          <div className={`border rounded-xl p-5 flex flex-col justify-between shadow-xs ${
                            darkMode ? "bg-[#0b1224] border-[#1e293b]" : "bg-white border-slate-205"
                          }`}>
                            <div>
                              <div className="flex items-center justify-between border-b pb-3 mb-3">
                                <div>
                                  <h4 className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${
                                    darkMode ? "text-slate-200" : "text-slate-800"
                                  }`}>
                                    <ClipboardList className={`w-4 h-4 ${darkMode ? "text-blue-500" : "text-indigo-500"}`} />
                                    Environmental Checklist
                                  </h4>
                                  <p className="text-[10px] text-slate-400 mt-0.5">Check and verify each dynamic item parameter:</p>
                                </div>
                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                                  darkMode ? "bg-slate-900 text-slate-400" : "bg-slate-100 text-slate-600"
                                }`}>
                                  {Object.values(checklistState).filter(Boolean).length}/{Object.keys(checklistState).length} Done
                                </span>
                              </div>

                              <div className="space-y-2 mb-4 max-h-[220px] overflow-y-auto pr-1">
                                {Object.keys(checklistState).length > 0 ? (
                                  Object.keys(checklistState).map((item, idx) => (
                                    <label key={idx} className={`flex items-start gap-2.5 p-2 rounded-lg transition-colors cursor-pointer text-[11px] select-none ${
                                      checklistState[item]
                                        ? darkMode ? "bg-emerald-950/10 text-slate-500" : "bg-slate-50 text-slate-400"
                                        : darkMode ? "bg-[#090d18] hover:bg-[#0f182c] text-slate-350" : "bg-slate-50/50 hover:bg-slate-100/60 text-slate-700"
                                    }`}>
                                      <input
                                        type="checkbox"
                                        checked={checklistState[item]}
                                        onChange={() => setChecklistState(prev => ({ ...prev, [item]: !prev[item] }))}
                                        className={`rounded focus:ring-1 cursor-pointer size-4 mt-0.5 shrink-0 ${
                                          darkMode 
                                            ? "border-slate-800 bg-slate-900 text-blue-500 focus:ring-blue-400/20" 
                                            : "border-slate-300 text-indigo-600 focus:ring-indigo-400/25"
                                        }`}
                                      />
                                      <span className={`leading-snug ${checklistState[item] ? "line-through" : ""}`}>{item}</span>
                                    </label>
                                  ))
                                ) : (
                                  <span className="text-[11px] text-slate-400 italic block text-center py-6">
                                    No key gathering tasks required.
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-[9px] text-slate-400 border-t pt-2 mt-2">
                              * Check off criteria list above as you collect environmental diagnostics from the end-user.
                            </p>
                          </div>

                          {/* Remediation Flowchart */}
                          <div className={`border rounded-xl p-5 flex flex-col justify-between shadow-xs ${
                            darkMode ? "bg-[#0b1224] border-[#1e293b]" : "bg-white border-slate-205"
                          }`}>
                            <div>
                              <div className="border-b pb-3 mb-3">
                                <h4 className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${
                                  darkMode ? "text-slate-200" : "text-slate-800"
                                }`}>
                                  <Wrench className={`w-4 h-4 ${darkMode ? "text-blue-500" : "text-indigo-500"}`} />
                                  Action Remediation Playbook
                                </h4>
                                <p className="text-[10px] text-slate-400 mt-0.5">Chronological operations flowchart compiled with web expertise:</p>
                              </div>

                              <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                                {routeResult.groundedKeyPoints?.extendedPlaybook && routeResult.groundedKeyPoints.extendedPlaybook.length > 0 ? (
                                  routeResult.groundedKeyPoints.extendedPlaybook.map((step, idx) => (
                                    <div key={idx} className="flex gap-2.5 items-start">
                                      <div className={`w-5 h-5 rounded-full font-mono text-[10px] font-bold flex items-center justify-center shrink-0 border ${
                                        darkMode 
                                          ? "bg-[#162544] border-blue-900 text-blue-400" 
                                          : "bg-indigo-50 border-indigo-200 text-indigo-700"
                                      }`}>
                                        {idx + 1}
                                      </div>
                                      <p className={`text-[11px] leading-relaxed ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                        {step}
                                      </p>
                                    </div>
                                  ))
                                ) : activeMatch.remediationPlaybook ? (
                                  // Fallback to split baseline Steps
                                  activeMatch.remediationPlaybook.split(/[\?\n\r]+/).map((step, idx) => {
                                    const cleanStep = step.replace(/^\??\s*/, "").replace(/^\d+[\.\-\s]*/, "").trim();
                                    if (!cleanStep) return null;
                                    return (
                                      <div key={idx} className="flex gap-2.5 items-start">
                                        <div className={`w-5 h-5 rounded-full font-mono text-[10px] font-bold flex items-center justify-center shrink-0 border ${
                                          darkMode 
                                            ? "bg-[#162544] border-blue-900 text-blue-400" 
                                            : "bg-indigo-50 border-indigo-200 text-indigo-700"
                                        }`}>
                                          {idx + 1}
                                        </div>
                                        <p className={`text-[11px] leading-relaxed ${darkMode ? "text-slate-300" : "text-slate-650"}`}>
                                          {cleanStep}
                                        </p>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <span className="text-xs text-slate-400 italic block text-center py-6">
                                    No troubleshooting procedures specified in database.
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-[9px] text-slate-400 border-t pt-2 mt-2 uppercase font-mono">
                              Step-by-Step Resolution Pathway
                            </p>
                          </div>
                        </motion.div>
                      )}

                      {/* Tab 3: Dispatch Coordinates */}
                      {activeResultsTab === "overview" && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="grid grid-cols-1 md:grid-cols-3 gap-4"
                        >
                          {/* Left Confidence Queue Card */}
                          <div className={`border rounded-xl p-4 flex flex-col justify-between shadow-2xs ${
                            darkMode ? "bg-[#0b1224] border-[#1e293b]" : "bg-white border-slate-205"
                          }`}>
                            <div>
                              <span className="text-[9px] text-slate-400 tracking-wider uppercase font-mono font-bold">Dispatched Destination</span>
                              <h3 className={`text-base font-bold font-mono tracking-tight mt-1 truncate ${darkMode ? "text-blue-400 font-semibold" : "text-indigo-700"}`}>
                                {activeMatch.assignedQueue}
                              </h3>
                              <div className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded font-semibold mt-2 border ${
                                darkMode 
                                  ? "bg-[#14213d]/40 border-blue-900/30 text-blue-400" 
                                  : "bg-indigo-50 border-indigo-100 text-indigo-700"
                              }`}>
                                {activeMatch.category}
                              </div>
                            </div>

                            <div className={`pt-4 border-t mt-4 ${darkMode ? "border-slate-800/80" : "border-slate-200/50"}`}>
                              <div className="flex items-center justify-between text-[11px] font-mono font-medium">
                                <span className="text-slate-450 font-bold uppercase text-[9px]">Match Accuracy Score</span>
                                <span className={`font-bold ${darkMode ? "text-blue-400" : "text-indigo-600"}`}>{activeMatch.matchingConfidence}%</span>
                              </div>
                              <div className={`w-full rounded-full h-1.5 mt-1.5 overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-200"}`}>
                                <div 
                                  className={`h-full rounded-full transition-all duration-500 bg-indigo-600 ${darkMode ? "bg-blue-500" : "bg-indigo-600"}`}
                                  style={{ width: `${activeMatch.matchingConfidence}%` }}
                                />
                              </div>
                              <span className="text-[9px] text-slate-400 block mt-1.5 leading-relaxed">
                                <strong>Search:</strong> {routeResult.searchMethodUsed}
                              </span>
                            </div>
                          </div>

                          {/* Justification quote card (spans two columns) */}
                          <div className={`col-span-1 md:col-span-2 border px-5 py-4 rounded-xl flex flex-col justify-between shadow-xs ${
                            darkMode ? "border-indigo-950 bg-[#0c162e]/40" : "border-indigo-100 bg-indigo-50/25"
                          }`}>
                            <div className="space-y-1.5">
                              <span className={`text-[10px] font-mono uppercase font-bold tracking-wider block ${darkMode ? "text-indigo-400" : "text-indigo-700"}`}>
                                AI Cognitive Dispatch Assessment
                              </span>
                              <p className={`text-xs italic leading-relaxed ${darkMode ? "text-slate-100" : "text-slate-700"}`}>
                                "{routeResult.cognitiveJustification}"
                              </p>
                            </div>

                            <div className="border-t pt-3 mt-4 text-slate-400 flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                              <div className="shrink-0 text-left max-w-sm">
                                <span className="text-[9px] block uppercase font-mono font-bold tracking-tight">Intent Designation Scoreboard</span>
                                <div className="flex flex-wrap gap-1.5 mt-1 font-mono text-[10px]">
                                  {routeResult.topMatches.map((m, i) => (
                                    <div key={i} className={`flex items-center gap-1 border px-2 py-0.5 rounded font-medium shadow-3xs ${
                                      darkMode ? "bg-[#0e1629] border-slate-800 text-slate-350" : "bg-white border-slate-200 text-slate-600"
                                    }`}>
                                      <span className="uppercase truncate max-w-[100px]" title={m.intent}>{m.intent}</span>
                                      <span className={`font-semibold ${darkMode ? "text-blue-405" : "text-indigo-600"}`}>{m.score}%</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {/* Tab 4: citations & sources */}
                      {activeResultsTab === "sources" && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`border rounded-xl p-5 shadow-2xs ${
                            darkMode ? "bg-[#0b1224] border-[#1e293b]" : "bg-white border-slate-205"
                          }`}
                        >
                          <div className="border-b pb-3 mb-3 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-2">
                            <div>
                              <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                                darkMode ? "text-slate-200" : "text-slate-800"
                              }`}>
                                <BookOpen className="w-4 h-4 text-emerald-500" />
                                Live Grounding Citations
                              </h4>
                              <p className="text-[10px] text-slate-400 mt-0.5">Verified references and citations gathered on-the-fly during cognitive search routing:</p>
                            </div>
                            <span className="text-[10px] self-start md:self-auto px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono font-bold">
                              Search Grounding Verified
                            </span>
                          </div>

                          <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                            {routeResult.groundedKeyPoints?.groundingSources && routeResult.groundedKeyPoints.groundingSources.length > 0 ? (
                              routeResult.groundedKeyPoints.groundingSources.map((src, i) => (
                                <div key={i} className={`flex items-center justify-between p-3 rounded-lg border text-xs transition duration-200 ${
                                  darkMode 
                                    ? "bg-[#0f192e]/60 border-slate-800 hover:border-slate-700 hover:bg-[#13213c]" 
                                    : "bg-slate-50 border-slate-100 hover:border-slate-205 hover:bg-slate-100/50"
                                }`}>
                                  <div className="flex items-center gap-2.5 truncate">
                                    <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 text-[10px] text-emerald-400 font-bold font-mono">
                                      {i + 1}
                                    </div>
                                    <div className="truncate">
                                      <span className={`font-semibold block truncate leading-snug ${darkMode ? "text-slate-150" : "text-slate-850"}`}>
                                        {src.title}
                                      </span>
                                      <span className="text-[9px] text-slate-400 block truncate font-mono mt-0.5">
                                        {src.url}
                                      </span>
                                    </div>
                                  </div>
                                  <a
                                    href={src.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold font-sans transition border shrink-0 ${
                                      darkMode 
                                        ? "text-blue-450 bg-blue-950/20 border-blue-900/30 hover:bg-blue-600 hover:text-white" 
                                        : "text-indigo-650 bg-indigo-50 border-indigo-100 hover:bg-indigo-600 hover:text-white"
                                    }`}
                                  >
                                    <span>Browse doc</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              ))
                            ) : (
                              <div className="text-center py-8">
                                <span className="text-[11px] text-slate-400 italic block">
                                  No external URL sources were returned from local offline playbook database records.
                                </span>
                                <p className="text-[10px] text-slate-500 mt-1 max-w-md mx-auto">
                                  Ensure Gemini credentials are fully configured and your network is active for full Google Search citations retrieval.
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>

            {/* Quick System controls Bento unit */}
            <div id="system-controls" className={`rounded-xl border shadow-xs p-6 flex flex-col justify-between space-y-4 ${darkMode ? "bg-[#0b1120] border-[#1e293b]/70" : "bg-white border-slate-200"}`}>
              
              <div className={`border-b pb-3 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <h2 className={`text-sm font-semibold flex items-center gap-1.5 font-sans ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                  <Layers className="w-4 h-4 text-slate-500" />
                  Administrative Synchronization Engine
                </h2>
                <p className={`text-xs mt-0.5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                  Dynamic cloud indexing, database replication controls and vector mappings
                </p>
              </div>

              {/* Status counts widgets */}
              <div className="grid grid-cols-2 gap-3">
                <div className={`border p-3.5 rounded-lg shadow-2xs ${darkMode ? "bg-[#14213d]/45 border-[#1e293b]/80" : "bg-slate-50 border-slate-200"}`}>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Spreadsheet Catalog</span>
                  <span className={`text-xl font-bold font-sans block mt-1 ${darkMode ? "text-white" : "text-slate-800"}`}>{stats.databaseSize}</span>
                  <span className="text-[9px] text-slate-400 block mt-0.5">Checked-in index rules</span>
                </div>
                <div className={`border p-3.5 rounded-lg shadow-2xs ${darkMode ? "bg-[#14213d]/45 border-[#1e293b]/80" : "bg-slate-50 border-slate-200"}`}>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Cognitive Vectors</span>
                  <span className={`text-xl font-bold font-sans block mt-1 ${darkMode ? "text-indigo-400" : "text-indigo-600"}`}>
                    {stats.databaseSize > 0 ? Math.round((stats.embeddedCount / stats.databaseSize) * 100) : 0}%
                  </span>
                  <span className="text-[9px] text-slate-400 block mt-0.5">{stats.embeddedCount} vectors loaded</span>
                </div>
              </div>

              {/* Cloud Sync section */}
              <div className="space-y-3">
                <div className={`p-3.5 border rounded-lg ${darkMode ? "bg-[#0f1d3a] border-blue-900/30 text-blue-200" : "bg-indigo-50/40 border-indigo-100 text-indigo-900"}`}>
                  <h3 className={`text-xs font-semibold flex items-center gap-1.5 ${darkMode ? "text-blue-305" : "text-indigo-900"}`}>
                    <Database className="w-3.5 h-3.5 text-indigo-500" />
                    Cloud Firestore Seeder
                  </h3>
                  <p className="text-[10px] text-slate-405 mt-1 leading-relaxed">
                    Bulk sync checklist configurations straight into the active Google Cloud Firebase Project. Avoids quota locks.
                  </p>
                  
                  <button
                    id="sync-button"
                    onClick={handleFirebaseSyncAll}
                    disabled={syncingAll || !stats.activeDatabase.includes("Firestore")}
                    className={`w-full text-xs font-bold border py-2 rounded-lg mt-2.5 transition cursor-pointer shadow-3xs ${
                      darkMode 
                        ? "bg-[#15274d] hover:bg-[#1a2f5c] border-[#1e345e] text-blue-300 disabled:bg-[#070b13] disabled:text-slate-650" 
                        : "bg-white hover:bg-slate-55 border-indigo-200 text-indigo-700 disabled:bg-slate-100 disabled:text-slate-400"
                    }`}
                  >
                    {syncingAll ? "Syncing Rules Catalog Data..." : "Bulk Seeding to Firestore"}
                  </button>
                </div>

                <div className={`p-3.5 border rounded-lg space-y-1.5 ${darkMode ? "bg-[#14213d]/45 border-[#1e293b]" : "bg-slate-50 border-slate-200"}`}>
                  <h3 className={`text-xs font-semibold flex items-center gap-1.5 ${darkMode ? "text-slate-200" : "text-slate-800"}`}>
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Embedding Vectorizer Panel
                  </h3>
                  <p className="text-[10px] text-slate-405 leading-relaxed">
                    Iteratively pass plain-text rules to the Gemini vector engine to build real mathematical matrices.
                  </p>

                  <div className="flex gap-2 pt-1">
                    <button
                      id="vectorize-batch-button"
                      onClick={handleVectorizeNext}
                      disabled={vectorizingBatch || !stats.hasGeminiApiKey}
                      className={`flex-1 text-[11px] font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer shadow-3xs ${
                        darkMode 
                          ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-550 text-white disabled:bg-slate-800 disabled:text-slate-500" 
                          : "bg-slate-900 hover:bg-slate-800 text-white disabled:bg-slate-200 disabled:text-slate-400"
                      }`}
                    >
                      <Play className="w-3 h-3 fill-white shrink-0 font-bold" />
                      Vectorize Batch (5 Items)
                    </button>
                  </div>
                  
                  {batchResult && (
                    <p className={`text-[9px] font-mono mt-2 border px-2 py-1 rounded ${
                      darkMode ? "bg-[#090d16] border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-500"
                    }`}>
                      {batchResult}
                    </p>
                  )}
                </div>
              </div>

              {/* Quick alert on keys */}
              {!stats.hasGeminiApiKey && (
                <div className={`border px-3 py-2.5 rounded-lg text-[10px] flex items-start gap-1.5 shadow-2xs ${
                  darkMode ? "bg-[#1a1712] border-amber-900/30 text-amber-200" : "bg-amber-50 border-amber-200 text-amber-800"
                }`}>
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong>Gemini Secret Empty:</strong> Go to <strong>Settings &gt; Secrets</strong> and register a valid <code>GEMINI_API_KEY</code> to enable AI vectorizing.
                  </p>
                </div>
              )}

            </div>

          </div>

          {/* Database Rules Registry Studio */}
          <div id="database-registry" className={`rounded-xl border p-6 shadow-xs flex flex-col overflow-hidden shrink-0 ${darkMode ? "bg-[#0b1120] border-[#1e293b]/70" : "bg-white border-slate-200"}`}>
            
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 mb-4 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
              <div>
                <h2 className={`text-base font-semibold flex items-center gap-1.5 font-sans ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                  <BookOpen className="w-4.5 h-4.5 text-indigo-500" />
                  Active Knowledge Rules Catalog Table
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sort, filter, discard, or formulate custom intent groups dynamically
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="add-rule-button"
                  onClick={openModalForNew}
                  className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border shadow-2xs transition-all cursor-pointer ${
                    darkMode 
                      ? "bg-blue-600 hover:bg-blue-500 text-white border-blue-700 hover:border-transparent" 
                      : "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700 hover:border-indigo-800"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add New Rule
                </button>
              </div>
            </div>

            {/* Filtering row */}
            <div className={`p-3.5 rounded-xl border mb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
              darkMode ? "bg-[#090d16] border-[#1e293b]" : "bg-slate-50/50 border-slate-100"
            }`}>
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Search className="w-4 h-4" />
                </span>
                <input
                  id="rules-search-input"
                  type="text"
                  placeholder="Query parameters, intents, category keys..."
                  value={searchQuery}
                  aria-label="Search rule keywords or intents"
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className={`w-full pl-9 pr-4 py-1.5 rounded-lg text-xs font-sans focus:outline-none transition-all shadow-3xs border ${
                    darkMode 
                      ? "bg-[#14213d] border-[#1e345e] focus:border-blue-500 text-slate-100 placeholder-slate-500" 
                      : "bg-white border-slate-200 text-slate-800 placeholder-slate-400 focus:border-indigo-500"
                  }`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <div className={`flex items-center gap-1.5 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-medium text-slate-500">Domain:</span>
                  <select
                    value={categoryFilter}
                    aria-label="Filter database by category"
                    onChange={(e) => {
                      setCategoryFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-sans focus:outline-none cursor-pointer shadow-3xs border ${
                      darkMode ? "bg-[#0e1629] border-[#1e293b] text-slate-200" : "bg-white border-slate-200 text-slate-700"
                    }`}
                  >
                    <option value="All">All Categories</option>
                    {categoriesList.map((c, i) => (
                      <option key={i} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className={`flex items-center gap-1.5 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  <span className="font-medium text-slate-500">Team Queue:</span>
                  <select
                    value={queueFilter}
                    aria-label="Filter database by assignment queue"
                    onChange={(e) => {
                      setQueueFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-sans focus:outline-none cursor-pointer shadow-3xs border ${
                      darkMode ? "bg-[#0e1629] border-[#1e293b] text-slate-200" : "bg-white border-slate-200 text-slate-700"
                    }`}
                  >
                    <option value="All">All Queues</option>
                    {queuesList.map((q, i) => (
                      <option key={i} value={q}>{q}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Table list view */}
            <div className={`overflow-x-auto border rounded-xl shadow-3xs ${darkMode ? "border-slate-800 bg-[#0e1629]" : "border-slate-200 bg-white"}`}>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`border-b text-[10px] font-bold uppercase tracking-wider ${
                    darkMode ? "bg-[#10192e] text-slate-400 border-slate-800" : "bg-slate-50/75 text-slate-400 border-slate-200"
                  }`}>
                    <th className="p-4 font-bold font-mono text-center w-12">ID</th>
                    <th className="p-4 font-bold">Intent Description</th>
                    <th className="p-4 font-bold">Domain Designation</th>
                    <th className="p-4 font-bold">Standard Support Queue</th>
                    <th className="p-4 font-bold max-w-sm">Example Queries</th>
                    <th className="p-4 font-bold text-center">Status</th>
                    <th className="p-4 font-bold text-center w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${darkMode ? "divide-slate-800/60" : "divide-slate-100"}`}>
                  {loadingKB ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400 font-sans">
                        <div className="flex items-center justify-center gap-2">
                          <RefreshCcw className="w-4 h-4 animate-spin text-indigo-500" />
                          <span className={`font-semibold ${darkMode ? "text-slate-350" : "text-slate-600"}`}>Querying live database records...</span>
                        </div>
                      </td>
                    </tr>
                  ) : kbItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className={`p-12 text-center font-sans ${darkMode ? "text-slate-500" : "text-slate-400"}`}>
                        No matches found inside database. Modify filter constraints.
                      </td>
                    </tr>
                  ) : (
                    kbItems.map((item) => {
                      // Custom tags logic for theme elegance
                      let catStyle = "bg-slate-50 text-slate-600 border-slate-200";
                      if (item.category.includes("Network")) {
                        catStyle = darkMode ? "bg-blue-950/40 text-blue-400 border-blue-900/30" : "bg-blue-50 text-blue-600 border-blue-200/50";
                      } else if (item.category.includes("Wintel")) {
                        catStyle = darkMode ? "bg-amber-950/40 text-amber-400 border-amber-900/30" : "bg-amber-50 text-amber-600 border-amber-200/50";
                      } else if (item.category.includes("Azure")) {
                        catStyle = darkMode ? "bg-purple-950/40 text-purple-400 border-purple-900/30" : "bg-purple-50 text-purple-600 border-purple-200/50";
                      } else if (item.category.includes("AD") || item.category.includes("Messaging")) {
                        catStyle = darkMode ? "bg-indigo-950/40 text-indigo-400 border-indigo-900/30" : "bg-indigo-50 text-indigo-600 border-indigo-200/50";
                      } else if (item.category.includes("Security")) {
                        catStyle = darkMode ? "bg-rose-950/40 text-rose-455 border-rose-900/30" : "bg-rose-50 text-rose-600 border-rose-200/50";
                      } else if (item.category.includes("SCCM")) {
                        catStyle = darkMode ? "bg-violet-950/40 text-violet-400 border-violet-900/30" : "bg-violet-50 text-violet-600 border-violet-200/50";
                      }

                      return (
                        <tr key={item.id} className={`transition-colors border-b ${
                          darkMode 
                            ? "hover:bg-[#14213d]/50 text-slate-300 border-slate-800" 
                            : "hover:bg-slate-50/50 text-slate-750 border-slate-100"
                        }`}>
                          <td className="p-3.5 text-center font-mono text-slate-450 font-bold">{item.id}</td>
                          <td className="p-3.5">
                            <div className={`font-semibold leading-snug ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{item.intent}</div>
                            <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{item.exampleQueries}</div>
                          </td>
                          <td className="p-3.5">
                            <span className={`inline-flex items-center text-[10px] px-2.5 py-0.5 rounded font-bold border ${catStyle}`}>
                              {item.category}
                            </span>
                          </td>
                          <td className="p-3.5">
                            <span className={`inline-flex items-center text-[10px] px-2.5 py-0.5 rounded font-mono font-medium shadow-3xs border ${
                              darkMode ? "bg-slate-900/85 border-slate-800 text-slate-350" : "bg-slate-100 border-slate-200 text-slate-700"
                            }`}>
                              {item.assignment}
                            </span>
                          </td>
                          <td className={`p-3.5 max-w-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                            <div className="line-clamp-2 leading-relaxed text-[10px]" title={item.troubleshootingSteps}>
                              <strong>Steps:</strong> {item.troubleshootingSteps || "No manual instructions provided."}
                            </div>
                          </td>
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center">
                              {item.embedding && item.embedding.length > 0 ? (
                                <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-bold border ${
                                  darkMode 
                                    ? "text-emerald-400 bg-emerald-950/45 border-emerald-900/30" 
                                    : "text-emerald-700 bg-emerald-50 border-emerald-250"
                                }`}>
                                  <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                                  Vectorized
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleVectorizeItem(item.id)}
                                  disabled={!stats.hasGeminiApiKey}
                                  className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold transition-all shadow-3xs cursor-pointer select-none disabled:opacity-40 disabled:pointer-events-none border ${
                                    darkMode 
                                      ? "text-blue-400 bg-blue-950/30 border-blue-900 hover:bg-blue-600 hover:text-white" 
                                      : "text-indigo-700 hover:text-white bg-indigo-50 hover:bg-indigo-600 border border-indigo-200 hover:border-indigo-600"
                                  }`}
                                  title={stats.hasGeminiApiKey ? "Analyze and index vector matrix" : "Secrets panel needs active Gemini Key"}
                                >
                                  Index rule
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="p-3.5">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleSimulateRuleText(item)}
                                className={`p-1.5 rounded-lg border border-transparent transition-all shrink-0 cursor-pointer ${
                                  darkMode 
                                    ? "text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/20 hover:border-emerald-900/30" 
                                    : "text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-205"
                                }`}
                                title="Simulate rule query in Playground"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => openModalForEdit(item)}
                                className={`p-1.5 rounded-lg border border-transparent transition-all shrink-0 cursor-pointer ${
                                  darkMode 
                                    ? "text-slate-400 hover:text-blue-400 hover:bg-[#132244] hover:border-blue-950/30" 
                                    : "text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-250"
                                }`}
                                title="Edit support rule attributes"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteKB(item.id)}
                                className={`p-1.5 rounded-lg border border-transparent transition-all shrink-0 cursor-pointer ${
                                  darkMode 
                                    ? "text-slate-400 hover:text-rose-450 hover:bg-rose-950/30 hover:border-rose-900/35" 
                                    : "text-slate-400 hover:text-rose-600 hover:bg-rose-55 hover:border-rose-100"
                                }`}
                                title="Remove support rule record"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controllers */}
            {totalPages > 1 && (
              <div className={`flex items-center justify-between border-t pt-4 mt-4 shrink-0 ${
                darkMode ? "border-slate-800 text-slate-400" : "border-slate-100 text-slate-500"
              }`}>
                <span className="text-xs font-medium">
                  Showing <strong>{Math.min((currentPage - 1) * 15 + 1, totalItems)}</strong> to <strong>{Math.min(currentPage * 15, totalItems)}</strong> of <strong>{totalItems}</strong> documents
                </span>

                <div className={`border p-1 rounded-lg flex items-center gap-1 ${
                  darkMode ? "bg-[#0b1120] border-slate-800" : "bg-white border-slate-200 shadow-3xs"
                }`}>
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className={`p-1 disabled:opacity-30 rounded-md transition-colors cursor-pointer ${
                      darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"
                    }`}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4 shrink-0" />
                  </button>
                  
                  <span className={`text-xs px-3 font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                    {currentPage}
                  </span>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className={`p-1 disabled:opacity-30 rounded-md transition-colors cursor-pointer ${
                      darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"
                    }`}
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  </button>
                </div>
              </div>
            )}

          </div>

        </main>
      </div>

      {/* Editor Modal Window Structure */}
      <AnimatePresence>
        {showEditorModal && (
          <div className="fixed inset-0 z-50 bg-[#02050c]/80 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className={`rounded-xl border shadow-xl max-w-lg w-full overflow-hidden flex flex-col p-6 space-y-4 ${
                darkMode ? "bg-[#0e1629] border-[#1e345e] text-slate-200" : "bg-white border-slate-200"
              }`}
            >
              <div className={`flex items-center justify-between border-b pb-3 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <h3 className={`text-sm font-bold flex items-center gap-1.5 font-sans ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                  <Layers className="w-4.5 h-4.5 text-indigo-500" />
                  {isEditingMode ? "Update KB Rule Configuration" : "Establish New Intent Routing Rule"}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowEditorModal(false)}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    darkMode ? "hover:bg-slate-800 text-slate-400 hover:text-slate-250" : "hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                  }`}
                >
                  <X className="w-4 h-4 shrink-0" />
                </button>
              </div>

              {modalError && (
                <div className={`p-2.5 rounded-lg text-[10px] flex items-center gap-1.5 border ${
                  darkMode ? "bg-rose-950/40 border-rose-900/35 text-rose-350" : "bg-rose-50 border-rose-100 text-rose-700"
                }`}>
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <form onSubmit={handleSaveRecord} className="space-y-4 text-xs leading-relaxed">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className={`font-bold block text-[10px] uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-700"}`}>Intent (Rule Label)*</label>
                    <input
                      type="text"
                      placeholder="e.g. system_failure"
                      value={formIntent}
                      onChange={(e) => setFormIntent(e.target.value)}
                      className={`w-full p-2.5 rounded-lg focus:ring-1 focus:outline-none font-sans border ${
                        darkMode 
                          ? "bg-[#090d16] border-[#1e345e] focus:border-blue-500 text-white placeholder-slate-600" 
                          : "bg-slate-50 border-slate-201 focus:border-indigo-500 text-slate-800 placeholder-slate-450"
                      }`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={`font-bold block text-[10px] uppercase tracking-wider ${darkMode ? "text-slate-440" : "text-slate-700"}`}>Domain Category*</label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className={`w-full p-2.5 rounded-lg focus:outline-none font-sans cursor-pointer border ${
                        darkMode 
                          ? "bg-[#090d16] border-[#1e345e] text-slate-205" 
                          : "bg-slate-50 border-slate-201 focus:border-indigo-500 text-slate-705"
                      }`}
                    >
                      {categoriesList.map((c, i) => (
                        <option key={i} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={`font-bold block text-[10px] uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-700"}`}>Dispatcher Target Queue*</label>
                  <select
                    value={formAssignment}
                    onChange={(e) => setFormAssignment(e.target.value)}
                    className={`w-full p-2.5 rounded-lg focus:outline-none font-sans cursor-pointer border ${
                      darkMode 
                        ? "bg-[#090d16] border-[#1e345e] text-slate-205" 
                        : "bg-slate-50 border-slate-201 focus:border-indigo-500 text-slate-705"
                    }`}
                  >
                    {queuesList.map((q, i) => (
                      <option key={i} value={q}>{q}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className={`font-bold block text-[10px] uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-700"}`}>Example Queries (Comma-separated cues)</label>
                  <input
                    type="text"
                    placeholder="e.g. windows freeze, system hangs, backup failed"
                    value={formQueries}
                    onChange={(e) => setFormQueries(e.target.value)}
                    className={`w-full p-2.5 rounded-lg focus:ring-1 focus:outline-none font-sans border ${
                      darkMode 
                        ? "bg-[#090d16] border-[#1e345e] focus:border-blue-500 text-white placeholder-slate-650" 
                        : "bg-slate-50 border-slate-201 focus:border-indigo-500 text-slate-800 placeholder-slate-450"
                    }`}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className={`font-bold block text-[10px] uppercase tracking-wider ${darkMode ? "text-slate-440" : "text-slate-700"}`}>Essential Checklist Details</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Error details, Hostname, Username"
                      value={formRequiredInfo}
                      onChange={(e) => setFormRequiredInfo(e.target.value)}
                      className={`w-full p-2.5 rounded-lg focus:ring-1 focus:outline-none font-sans text-xs border ${
                        darkMode 
                          ? "bg-[#090d16] border-[#1e345e] focus:border-blue-500 text-white placeholder-slate-655" 
                          : "bg-slate-50 border-slate-201 focus:border-indigo-500 text-xs text-slate-800 placeholder-slate-450"
                      }`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={`font-bold block text-[10px] uppercase tracking-wider ${darkMode ? "text-slate-440" : "text-slate-700"}`}>Remediation Steps Playbook</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Run ping check ? Inspect cables ? Clear print pool"
                      value={formSteps}
                      onChange={(e) => setFormSteps(e.target.value)}
                      className={`w-full p-2.5 rounded-lg focus:ring-1 focus:outline-none font-sans text-xs border ${
                        darkMode 
                          ? "bg-[#090d16] border-[#1e345e] focus:border-blue-500 text-white placeholder-slate-655" 
                          : "bg-slate-50 border-slate-201 focus:border-indigo-500 text-xs text-slate-800 placeholder-slate-450"
                      }`}
                    />
                  </div>
                </div>

                <div className={`flex items-center justify-end gap-2 pt-3 border-t mt-4 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                  <button
                    type="button"
                    onClick={() => setShowEditorModal(false)}
                    className={`px-4 py-2 border rounded-lg font-semibold transition-colors cursor-pointer ${
                      darkMode ? "border-[#1e345e] hover:bg-slate-800 text-slate-300" : "border-slate-200 hover:bg-slate-100 text-slate-600"
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingRecord}
                    className={`px-4 py-2 font-semibold rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer shadow-3xs border ${
                      darkMode 
                        ? "bg-blue-600 hover:bg-blue-505 text-white border-blue-700" 
                        : "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-750 hover:border-indigo-800"
                    }`}
                  >
                    {savingRecord ? "Saving parameters..." : "Save Rule details"}
                  </button>
                </div>
              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className={`text-center py-4 text-xs shrink-0 border-t ${
        darkMode ? "bg-[#070b13] border-slate-900/70 text-slate-500" : "bg-white border-slate-200 text-slate-450"
      }`}>
        <p>© 2026 Enterprise Support Division. All rights reserved.</p>
      </footer>

    </div>
  );
}
