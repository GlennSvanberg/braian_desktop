Gemini said
This summary is designed to be saved as NOTES.md in your project root to provide the LLM with the necessary architectural guardrails and vision for Braian Desktop.

Braian Desktop: Technical Vision & Context
1. The Core Vision: "The Invisible Employee"
Braian Desktop is a local-first, AI-native operational hub for business users. Unlike standard AI chat interfaces (like ChatGPT) or coding-centric IDEs (like Cursor), Braian is a Claude Artifacts-inspired workspace that prioritizes doing over talking.

The goal is to shift the primary interface from a linear chat to a persistent, interactive Artifact (Dashboard). Braian doesn't just suggest code; it reads local business data (Excel, CSV, SQL), generates scripts to manipulate that data, and renders real-time dashboards where users can take direct actions.

2. Architectural Principles
To ensure high performance, deep privacy, and future scalability, the project follows these rules:

Local-First, Sync-Later: All data resides on the user's machine. Cloud sync (Convex) is a future layer; the MVP is entirely local.

Artifact-Centric UI: The chat is a side-tool used to manipulate the "Canvas" (the Artifact/Dashboard).

Agentic Execution: Braian uses MCP (Model Context Protocol) to execute "Skills"—local scripts or tools that interact with the file system.

Abstraction for Business: Technical terms (RAG, LLM, Embeddings) are hidden. The user sees "Skills," "Dashboards," and "Actions."

3. Technical Stack
Framework: Tauri (Rust backend for secure, deep file access; React frontend).

Frontend: TanStack Start (for type-safe routing and state-driven rendering).

State/Database: SQLite (local storage for configuration, chat history, and dashboard metadata).

Connectivity: MCP (Model Context Protocol) sidecars for extensible skills (e.g., local Excel reader, terminal executor).

Rendering: Shadcn/ui + TanStack Table/Charts for high-quality, interactive Artifacts.

4. Phase 1 Scope (The MVP)
The immediate goal is to build the "Excel-to-Dashboard" pipeline:

File Watcher: A Tauri-based watcher that monitors a local Excel/CSV file.

The Bridge: A Rust command that parses the local file into a clean JSON structure.

The Artifact: A reactive React dashboard that displays this data in a virtualized table/chart.

The Skill Loop: A basic "Find/Replace" agent that can modify local text files based on user requests within the chat.

Local State: Persisting the dashboard configuration in a local SQLite database so it remains available across app restarts.

5. Development Guidelines for Cursor
Sync-Ready Data: Use UUIDs and timestamps for all database entries to ensure future cloud synchronization doesn't cause conflicts.

Actionable Code: Favor creating scripts that can be executed via the Tauri shell over providing raw code snippets in the chat.

Component Modularity: Build dashboard widgets as highly modular, state-driven React components that can be easily rearranged by the AI.

Current Focus: Implementing the Tauri + TanStack Start foundation with local file system read/write capabilities.