# Connections

> This file maps relationships between features at the topic level.
> It is always loaded at the start of every session.
> Use it to identify blast radius before making changes.
>
> Format: source/topic → target/topic : reason for connection
> Use ↔ for bidirectional, → for one-way dependencies

<!-- Example:
call-ingestion/storage-schema ↔ reporting/queries : shared call_records table
call-ingestion/webhook-handling → auth/tenant-resolution : every webhook resolves tenant
call-ingestion/caching → reporting/dashboard-api : cache invalidation affects display
-->
