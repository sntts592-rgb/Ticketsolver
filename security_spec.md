# Security Specification for IT Tickets KB (Zero-Trust Model)

## 1. Data Invariants
- **tickets_kb Collection**:
  - `id`: Must be a valid integer, non-null, uniquely identifying the record.
  - `intent`: Clean string, representing the ticket classification intent (e.g., `wifi_issue`), maximum length 128 characters.
  - `category`: Clean string, matching one of the department domains (e.g., `Network`, `Messaging`, `Wintel`, `Azure`, `Asset Management`, `Endpoint Security`), maximum length 128 characters.
  - `assignment`: Target team/queue queue string, maximum length 128 characters.
  - `combinedText`: Structured representation of the row fields for semantic search matching.
  - `embedding`: If present, must be an array of floats representing the sentence embeddings structure.

## 2. The "Dirty Dozen" Malicious Payloads

The following payload attempts will be programmatically blocked by our security rules:

1. **Attempting Unauthenticated Create**: Writing a new KB entry without a valid credential token.
2. **Ghost Property Injection (Shadow Field)**: Injecting an unmapped field, e.g., `isAdmin: true` into the `tickets_kb` model.
3. **Identity Spoofing**: Attempting to set or spoof administrative IDs or user records from the client.
4. **ID Poisoning / Extreme String Length**: Using an excessively large string ID or malicious character block (e.g., `../poison_id` or 1KB long ID string) to cause resource congestion.
5. **String Value Bloating**: Sending a string of length > 2MB into `troubleshootingSteps` to exceed storage limits.
6. **Type Mismatch Violation**: Attempting to write a string value for the `id` property (e.g. `id: "one_hundred"`).
7. **Negative ID Value Range**: Writing a negative integer for `id` (less than or equal to 0).
8. **Null/Empty Mandatory Keys**: Inserting a document with missing mandatory elements such as `intent`, `category`, or `assignment`.
9. **Float Array Size Attack**: Inserting a massive coordinate float array (> 2048 dimensions) into `embedding` to inflate index sizes.
10. **Terminal Status Bypass / Modification**: Modifying system-only protected fields or records once they are finalized.
11. **Bypassing Server Timestamps with Client Clock**: Supplying manual client-side values for audit timestamps instead of using `request.time`.
12. **Blanket Collection Scraping (Client-Side Query Hijacking)**: Attempting to pull all records from the collection using simple unrestricted client list queries.

## 3. Rule Implementation Plan
The Firestore security rules will implement strict validation:
- Global default lock (`allow read, write: if false;`)
- Schema validation helpers checking types, sizes, and formats.
- Complete audit timestamp verification with `request.time`.
- Relational validation constraints.
