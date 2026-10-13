# Architecture

POLYSUB connects a remote AI conversation with work that lives on the user's computer. This document describes the source-preview architecture and responsibility boundaries. Installation, operations, security configuration, and deployment history are documented separately.

## The main path

The product's single main chain is:

```text
ChatGPT / phone
      |
      v
external Tunnel / transport
      |
      v
POLYSUB Bridge (MCP/HTTP boundary)
      |
      +--> direct read of an authorized folder for a simple request
      |
      +--> Codex-assisted work for analysis, testing, execution, or changes
                    |
                    v
             local Codex App Server adapter
                    |
                    v
             bounded job and session state
                    |
                    v
             completion record / durable outbox
                    |
                    v
             optional Blue-Wake handoff and receiver Widget
                    |
                    v
             host-side render and return to the originating conversation
```

The Bridge owns the local connection boundary and the choice between direct folder access and Codex-assisted work. The Tunnel, the conversation host, and the phone UI are integration surfaces around the Bridge; they are not alternative Bridge implementations.

## The two work modes

### Bridge-direct mode

For a simple read, the Bridge can work directly with files in an authorized project folder. This avoids starting a Codex turn when the request only needs local file access. The result returns through the same Bridge/Tunnel path.

### Codex-assisted mode

When the request needs project reasoning, testing, execution, or an intentional change, the Bridge hands the work to local Codex through its App Server adapter. The Bridge keeps the task identity and session relationship, then returns an immediate result or a running task that can be continued through completion state.

In the current source preview, `codex_read` is the implemented read-only Codex inspection operation; it is not a generic direct-file-read MCP tool. The direct-read role above is the product-level Bridge responsibility and must not be confused with `codex_read`.

## Component responsibilities and boundaries

| Component | Responsibility | Boundary |
| --- | --- | --- |
| ChatGPT / phone | Starts the request and presents the returned result. | External conversation and device surface. |
| Tunnel / transport | Carries the request and response between the conversation host and the local service. | External connectivity integration; not provisioned by this source package. |
| Bridge server | Exposes the MCP/HTTP entry point, resolves the authorized working area, selects a work mode, and routes results. | POLYSUB core. One authoritative request path. |
| Codex App Server adapter | Starts and continues local Codex work on behalf of the Bridge. | POLYSUB integration with the external Codex runtime. |
| Job and session state | Tracks caller task IDs, running work, and continuations across requests. | POLYSUB core execution state. |
| Completion outbox | Retains completed results until the receiver reads and acknowledges them. | POLYSUB core delivery state. |
| Blue-Wake | Provides the optional handoff marker, completion receiver, and widget resources for a long-running result. | POLYSUB integration candidate; actual host rendering remains external. |
| Host Widget / conversation return | Mounts the receiver and presents the completion in the originating conversation. | External host capability and UI surface. |

The source-level responsibilities follow the same boundary: `server.ts` owns the HTTP/MCP server, `tools.ts` owns Bridge tools and jobs, `upstream.ts` owns the Codex adapter, `sessionRegistry.ts` owns continuation state, `completionOutbox.ts` owns durable completion state, and `blueWake.ts` owns the optional widget handoff.

## POLYSUB core and external integration

POLYSUB core is the local Bridge, its MCP/HTTP server, configuration and authorized-folder resolution, tool dispatch, Codex adapter, bounded job/session state, completion outbox, and optional Blue-Wake resources.

External or host integration includes ChatGPT and phone interfaces, the Tunnel/provider connection, the Codex runtime itself, and the host's ability to mount a Widget, accept a handoff, and show the returned result. The source preview does not claim that those external surfaces are implemented or verified by this repository.

## KEEP FLAT and one authoritative implementation

The source remains flat and responsibility-oriented. Each concern has one authoritative implementation:

- one Bridge server and MCP request path;
- one Bridge tool registration and dispatch layer;
- one Codex App Server adapter;
- one job/session state model;
- one durable completion path, with Blue-Wake attached to that completion rather than creating a second result path;
- one Widget handoff flow for the optional host integration.

New behavior belongs in the module that owns its concern. A second server, tool registry, state store, completion queue, or widget flow must not be added merely to mask a defect or preserve an ambiguous older path. KEEP FLAT means the architecture stays understandable, traceable, and recoverable from one authoritative implementation.
