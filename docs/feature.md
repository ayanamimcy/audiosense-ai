# Feature Roadmap

## Second Version

### 1. Terminology and Transcription Quality
- Add a managed glossary for domain-specific terms, names, products, and abbreviations.
- Support transcription-time prompts or hotwords so important terms are recognized more reliably.
- Add post-processing normalization so aliases and common misrecognitions map back to the desired canonical term.
- Allow reprocessing a single task with task-specific glossary or transcription hints.
User value:
- improves transcript accuracy for professional or domain-specific recordings
- increases trust in summaries, chat, and search
Technical scope:
- add glossary data model and UI
- pass glossary or prompt context into transcription requests
- add post-transcription normalization layer
- support per-task reprocess options
Complexity: High
Priority: Highest

### 2. Workspace Batch Management
- Keep `Workspace` as the single recording management entry point.
- Expand batch operations for recordings:
  - assign notebook
  - update tags
  - move back to inbox
  - batch delete
- Improve feedback for batch actions, including partial success and retry flows.
User value:
- makes large recording libraries manageable without repetitive manual edits
- reduces cleanup time after uploads or meetings
Technical scope:
- extend batch actions in workspace state and UI
- add shared batch update APIs where needed
- improve success, failure, and retry feedback for partial operations
Complexity: Medium
Priority: Highest

### 3. Upload Experience and Reliability
- Show real upload progress instead of only queued or waiting states.
- Improve large file upload feedback with clearer states for uploading, queued, processing, and failed.
- Add retry-friendly upload flows for unstable public network environments.
- Prepare the architecture for direct object storage upload in production.
User value:
- reduces confusion during large uploads
- improves confidence that long uploads are still progressing
- lowers frustration on slow or unstable networks
Technical scope:
- replace opaque upload flow with progress-aware upload handling
- improve task status transitions and UI messaging
- prepare server endpoints for object storage upload sessions
- add resumable or retry-friendly upload structure
Complexity: High
Priority: Highest

### 4. Basic Knowledge Capture
- Allow saving transcript segments or sentences as bookmarks.
- Support timestamp-based bookmarks for important moments in a recording.
- Add a simple saved-items list so users can revisit important excerpts later.
- Allow lightweight notes on saved transcript fragments.
User value:
- turns transcripts into reusable personal knowledge instead of one-time consumption
- makes it easier to revisit important moments
Technical scope:
- add bookmark and saved-snippet data model
- add save actions from transcript UI
- add saved-items list and note support
Complexity: Medium
Priority: Medium

## Third Version

### 1. Search and Retrieval Improvements
- Improve search result snippets so users can understand why a recording matched.
- Add clearer filters by notebook, tag, time range, and processing state.
- Let search results jump directly to the matching transcript timestamp.
- Improve retrieval quality for cross-recording Q&A.
User value:
- helps users find the right recording or excerpt faster
- improves usefulness of knowledge search as the library grows
Technical scope:
- enrich indexed metadata and snippets
- improve search result rendering and filters
- connect search hits to transcript timestamps
- refine retrieval and ranking logic
Complexity: Medium
Priority: Medium

### 2. AI Review and Study Support
- Add sentence-level explanation and interpretation for transcript content.
- Extract key decisions, action items, and notable moments automatically.
- Generate structured notes from summaries, transcript snippets, and bookmarks.
- Let users ask follow-up questions on saved content, not only the whole task.
User value:
- makes the product more useful for review, learning, and post-meeting analysis
- helps users turn recordings into structured outputs faster
Technical scope:
- add sentence-level AI actions
- support excerpt-based prompting and follow-up
- add derived note views for saved content
Complexity: High
Priority: Medium

### 3. Automatic Organization
- Add rule-based auto-tagging from filename, source, or detected keywords.
- Support automatic notebook assignment for common recording types.
- Add optional automatic summary and tag generation workflows after upload.
- Strengthen the inbox triage flow so new recordings are easier to process in batches.
User value:
- reduces manual organization work
- keeps inboxes from growing unbounded
Technical scope:
- add organization rules model and rule execution
- integrate rules into upload and processing pipeline
- add inbox triage states and automation hooks
Complexity: High
Priority: Medium

### 4. Runtime and System Stability
- Improve `local-python` stability with clearer error classification.
- Add better fallback and recovery behavior across providers.
- Expose more detailed task states so users understand where processing is blocked.
- Improve observability for long-running transcription and summary jobs.
User value:
- makes the system feel dependable
- reduces silent failures and confusing stuck states
Technical scope:
- classify retryable versus terminal failures
- improve provider routing and fallback logic
- add clearer status events and diagnostics
- improve runtime health and processing telemetry
Complexity: High
Priority: Medium

## Later Versions

### 1. Learning Mode
- Add bilingual transcript support for language learning scenarios.
- Support single-sentence replay and loop playback.
- Allow vocabulary and phrase collection from transcript segments.
- Add follow-along and focused listening workflows for study use cases.
User value:
- expands the product into a language-learning workflow
- makes recordings usable for deliberate practice, not only reference
Technical scope:
- add bilingual display model
- add sentence-level playback controls
- support vocabulary collection and study-specific UI
Complexity: High
Priority: Later

### 2. Knowledge Workspace Expansion
- Turn saved snippets and bookmarks into structured notebook notes.
- Add stronger cross-recording reasoning with better source grounding.
- Support richer excerpt-level references across tasks.
- Upgrade vector search architecture when scale requires it, such as moving toward `pgvector`.
User value:
- turns saved content into a deeper long-term knowledge base
- improves cross-recording synthesis as data volume grows
Technical scope:
- add note-building flows from excerpts
- improve citation and excerpt-level linking
- prepare search layer for larger-scale vector retrieval
Complexity: High
Priority: Later

### 3. Collaboration and Sharing
- Share task summaries or selected transcript excerpts.
- Export notes or structured outputs for external workflows.
- Introduce team-level tag systems and shared prompt conventions.
- Add reusable workflow templates for recurring recording types.
User value:
- supports teams and repeatable workflows
- makes results easier to reuse outside the product
Technical scope:
- add sharing and export flows
- support team metadata conventions
- introduce reusable workflow templates
Complexity: Medium
Priority: Later

## Prioritization Guidance

### Highest Priority
- terminology and transcription quality
- workspace batch management
- upload experience and reliability

### Medium Priority
- bookmarks and saved snippets
- search and retrieval improvements
- automatic organization

### Later Strategic Differentiators
- learning mode
- knowledge workspace expansion
- collaboration and sharing

## Product Direction

The product already has strong foundations in upload, recording, transcription, summary, chat, search, and notebook organization. The next stages should focus less on adding more pages and more on making the system:

- more accurate
- easier to organize at scale
- more reliable on large inputs
- better at turning recordings into reusable knowledge

## Suggested Development Order

1. Terminology and transcription quality
2. Workspace batch management
3. Upload experience and reliability
4. Basic knowledge capture
5. Search and retrieval improvements
6. Automatic organization
7. Runtime and system stability
8. AI review and study support
9. Learning mode
10. Knowledge workspace expansion
11. Collaboration and sharing
