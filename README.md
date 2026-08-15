# Booking Harmony

Role

Act as a Principal Software Architect, Senior Backend Engineer, Distributed Systems Engineer, Database Architect, and Product Designer with experience building high-volume booking, scheduling, event-driven, audit-compliant, and AI-assisted platforms.

You are responsible for designing a production-quality, scalable, maintainable, and testable consultation booking platform based on the requirements below.

Do not jump directly into coding. First analyze the requirements, identify ambiguities and architectural risks, and then propose a complete technical architecture before implementation.

Product Objective

Design a consultation booking platform where users can book sessions with experts across domains such as healthcare, finance, and technology.

The system must:

Accept bookings from multiple sources.

Detect overlapping bookings for the same expert.

Automatically resolve conflicts using a deterministic AI/rule engine.

Maintain complete booking state and version history.

Handle duplicate and out-of-order events.

Replay historical events to reconstruct the same state.

Produce deterministic decisions from identical inputs and configuration.

Maintain a complete audit trail explaining every decision.

Support retries and idempotent operations.

Provide a frontend for booking, conflict visualization, decision history, and audit inspection.

The most important architectural goals are:

Consistency, determinism, replayability, auditability, idempotency, scalability, and explainability.

Technology Constraints

Use only the following technologies:

Backend: Node.js or Flask

Frontend: React.js

Database: PostgreSQL

Language options: JavaScript/TypeScript, Python, and C++

Infrastructure: AWS EC2

Version control: Git

IDE: VS Code

Do NOT use:

Kubernetes

Distributed microservice infrastructure

External LLM APIs

External ML APIs

Third-party AI decision services

Redis unless explicitly justified

Kafka/RabbitMQ unless explicitly justified

External event-streaming infrastructure

The initial deployment must be capable of running on a single EC2 instance, while the architecture should allow future horizontal scaling without requiring a complete rewrite.

Architecture Principles

Design the system using the following principles:

Modular architecture

Clear separation of concerns

Domain-driven design where appropriate

Event-driven state tracking

PostgreSQL as the source of truth

Immutable event history

Deterministic decision making

Idempotent commands and events

Optimistic concurrency/version control

Strong auditability

Reproducible historical decisions

Transactional consistency

Secure API design

Observability

Testability

Configuration versioning

Avoid unnecessary complexity. The solution must be practical for an MVP while having a clean path toward production scale.

Core Domain Model

Design appropriate entities and relationships for:

User

Expert

Expert availability

Booking

Booking source

Session type

Conflict

Conflict group

Resolution decision

Resolution rule

Resolution configuration

Event

Audit record

Booking version

Idempotency key

Define:

Entity responsibilities

Primary keys

Foreign keys

Indexes

Constraints

Relationships

Lifecycle/state transitions

Booking Lifecycle

Design a formal state machine for:

Pending
Confirmed
Rejected
Rescheduled
Cancelled


Define valid and invalid transitions.

For every transition, specify:

Triggering command/event

Previous state

New state

Version change

Validation requirements

Audit requirements

Prevent invalid state transitions.

Conflict Detection

A conflict occurs when bookings for the same expert overlap.

Design a reliable PostgreSQL-based conflict detection strategy.

Consider:

expert_id
start_time
end_time
booking_state
timezone


The system should correctly handle:

Exact overlap

Partial overlap

Nested booking

Adjacent bookings

Multiple simultaneous conflicts

Cancelled bookings

Rescheduled bookings

Late-arriving bookings

Explain the database indexes and queries required for efficient conflict detection.

If PostgreSQL range types or exclusion constraints are appropriate, evaluate and explain their use.

Deterministic AI Decision Engine

The "AI" engine must be implemented without external AI services.

Create a configurable deterministic scoring engine.

The engine should consider:

Priority level

High

Medium

Low

Expert historical booking success rate

User historical session completion rate

Session type

Emergency

Priority

Routine

Time of day

Expert availability

Historical conflict-resolution patterns

Create a scoring model such as:

final_score =
    priority_score
    + expert_score
    + user_score
    + session_type_score
    + time_score


However, do not blindly use this formula. Evaluate the requirements and propose the most robust scoring architecture.

The engine must:

Be deterministic

Be configurable

Be versioned

Produce a confidence score

Produce structured reasoning

Produce a complete decision trace

Never depend on randomness

Never depend on external APIs

Produce identical output for identical input + configuration

Decision Explainability

Every decision must produce structured output similar to:

{
  "decision": "CONFIRMED",
  "confidence": 0.91,
  "configuration_version": 4,
  "score": 87.5,
  "reasoning": [
    {
      "factor": "priority",
      "input": "HIGH",
      "weight": 0.35,
      "score": 35
    },
    {
      "factor": "session_type",
      "input": "EMERGENCY",
      "weight": 0.25,
      "score": 25
    }
  ],
  "tie_breaker": null
}


Design a better production-quality structure if appropriate.

The decision trace must allow an auditor to understand exactly why a booking was accepted or rejected.

Deterministic Tie Breaking

Design explicit deterministic tie-breaking rules.

For example:

1. Highest final score
2. Highest priority
3. Most important session type
4. Earliest logical event timestamp
5. Deterministic booking ID ordering


The exact rules should be evaluated and improved.

The system must never rely on:

Database row order

Network arrival order

Randomness

Current time

Non-deterministic external services

unless those values are explicitly persisted as part of the event/decision input.

Event Architecture

Design an immutable event model.

Example events:

BookingCreated
BookingUpdated
BookingCancelled
ConflictDetected
ResolutionRequested
ResolutionCalculated
BookingConfirmed
BookingRejected
BookingRescheduled


Every event should contain appropriate metadata such as:

event_id
event_type
aggregate_id
aggregate_type
aggregate_version
logical_sequence
occurred_at
recorded_at
source
correlation_id
causation_id
payload
configuration_version


Explain which fields are required and why.

Out-of-Order Events

The system must handle events arriving in an order different from their logical occurrence order.

Design a strategy that guarantees deterministic reconstruction.

Do NOT simply process events according to arrival time.

Explain how the system determines logical ordering.

Address:

Late events

Duplicate events

Missing events

Conflicting versions

Replayed events

Concurrent updates

Explain what happens when an event cannot be safely applied.

Replay Engine

Design a replay mechanism capable of reconstructing booking state from historical events.

Replay must:

Load events.

Deduplicate them.

Establish deterministic logical ordering.

Reconstruct state.

Recalculate conflicts.

Recalculate decisions using the historical configuration version.

Compare reconstructed state against current state.

Report inconsistencies.

The replay operation must NOT mutate production state unless explicitly requested.

Support:

dry-run replay
full replay
single-booking replay
single-conflict replay
date-range replay


Provide a clear replay algorithm.

Idempotency

Design idempotency for:

Booking creation

Booking updates

Event processing

Conflict resolution

Replay

For example:

Idempotency-Key


should prevent duplicate booking creation when a client retries a request.

Explain the PostgreSQL schema and transaction strategy for enforcing idempotency.

Concurrency Control

Multiple users may attempt to book the same expert simultaneously.

Design a strategy to prevent inconsistent booking state.

Evaluate:

PostgreSQL transactions

Row-level locking

Optimistic locking

Version numbers

Serializable transactions

PostgreSQL exclusion constraints

Choose the appropriate strategy and explain why.

Audit Trail

Design an immutable audit system capturing:

User/request identity

Expert ID

Booking ID

Input data

Previous state

New state

Decision

Reasoning

Score

Configuration version

Event ID

Timestamp

Request ID

Correlation ID

System version

Audit records must be traceable from:

Booking
→ Conflict
→ Decision
→ Event
→ Audit Record


Explain how audit integrity is preserved.

API Design

Design REST APIs for:

Booking

POST   /api/v1/bookings
GET    /api/v1/bookings/:id
PATCH  /api/v1/bookings/:id
POST   /api/v1/bookings/:id/cancel


Conflicts

GET /api/v1/conflicts
GET /api/v1/conflicts/:id
POST /api/v1/conflicts/:id/resolve


Replay

POST /api/v1/replay
POST /api/v1/replay/booking/:id
GET  /api/v1/replay/:id


Audit

GET /api/v1/audit/bookings/:id
GET /api/v1/audit/decisions/:id


Improve these APIs where necessary.

For each API define:

Request schema

Response schema

HTTP status codes

Validation

Authentication assumptions

Idempotency behavior

Error format

Versioning

Error Handling

Create a standardized error model.

Handle:

Invalid booking

Invalid expert

Expert unavailable

Conflict

Version mismatch

Duplicate request

Invalid state transition

Replay failure

Missing event

Configuration mismatch

Database failure

Use consistent machine-readable error codes.

Database Design

Provide a complete PostgreSQL schema.

Include:

Tables

Columns

Data types

Primary keys

Foreign keys

Unique constraints

Check constraints

Indexes

Transactions

Version fields

Audit fields

Pay particular attention to:

Booking overlap queries

Event lookup

Replay performance

Audit queries

Conflict-group queries

Explain indexing strategy.

Frontend

Design a professional React application containing:

Dashboard

Show:

Total bookings

Confirmed

Rejected

Pending

Active conflicts

Recent decisions

Booking Interface

Allow users to:

Select expert

Select date/time

Select session type

Select priority

Submit booking

Conflict View

Display:

Conflicting bookings

Scores

Decision

Confidence

Reasoning

Timeline

Booking Timeline

Visualize:

Booking Created
      ↓
Conflict Detected
      ↓
Resolution Calculated
      ↓
Booking Confirmed


Audit View

Display:

Event history

State transitions

Decision trace

Configuration version

Replay result

Use a clean, professional enterprise UI.

Security

Design appropriate security controls.

Consider:

Authentication

Authorization

Input validation

SQL injection prevention

API rate limiting

Sensitive data handling

Audit protection

Secure configuration

Secrets management

HTTPS

CORS

Request validation

Do not over-engineer authentication if it is outside MVP scope, but clearly define the production approach.

Performance

The resolution engine must respond within:

500 ms for 95% of requests.

Design for:

Efficient SQL

Proper indexes

Minimal database round trips

Cached configuration where appropriate

Deterministic computation

Transaction boundaries

Efficient replay

Define measurable performance targets for:

Booking creation

Conflict detection

Resolution

Replay

Audit queries

Scalability

Although the MVP runs on one EC2 instance, design the application so that it can eventually scale.

Explain how the architecture could evolve from:

Single EC2
+
PostgreSQL


to:

Load Balancer
      ↓
Multiple API instances
      ↓
PostgreSQL


without redesigning the domain model.

Identify potential bottlenecks and how they could eventually be addressed.

Do not introduce distributed infrastructure unless it is genuinely necessary.

Testing Strategy

Create a comprehensive automated test strategy.

Include:

Unit Tests

Scoring

Rules

Tie breakers

State transitions

Event ordering

Replay

Idempotency

Integration Tests

API + PostgreSQL

Booking + conflict detection

Booking + resolution

Replay + database

Edge Cases

At minimum:

Two identical bookings

High vs Low priority

Multiple conflicting bookings

Duplicate event

Out-of-order event

Late event

Version conflict

Retry after failure

Identical scoring

Configuration version change

Cancelled booking

Rescheduled booking

For every test, explain:

Input

Expected state

Expected decision

Expected audit output

Fixture Dataset

Create at least five realistic fixture scenarios.

Prefer 8–10 fixtures.

Each fixture should include:

Input events
Expected ordering
Expected conflicts
Expected decisions
Expected final state
Expected audit trace


Make fixtures deterministic and human-readable.

Observability

Design:

Structured logging

Request IDs

Correlation IDs

Decision IDs

Event IDs

Error logs

Performance metrics

A production engineer should be able to trace:

HTTP request
→ booking
→ conflict
→ resolution
→ event
→ audit


using correlation identifiers.

Project Structure

Propose a clean production-oriented repository structure.

Separate:

domain
application
infrastructure
API
database
events
resolution
replay
audit
tests
frontend
fixtures
scripts


Keep business logic independent from HTTP and database implementation where practical.

Documentation

Create a professional README containing:

Product overview

Architecture

Technology stack

Database design

Event model

Resolution algorithm

Replay mechanism

API documentation

Setup

Environment variables

Database migration

Seed data

Running backend

Running frontend

Running tests

Running replay

Example booking

Example conflict

Example decision trace

Deployment to AWS EC2

Troubleshooting

Future scalability

Required Deliverables

Produce the following in sequence:

Phase 1 — Architecture

Provide:

System architecture

Component architecture

Data flow

Booking lifecycle

Event lifecycle

Replay architecture

Conflict-resolution architecture

Security architecture

Scalability strategy

Phase 2 — Database

Provide:

ER diagram

PostgreSQL schema

Migration strategy

Index strategy

Constraints

Phase 3 — Backend

Provide:

Folder structure

API contracts

Domain models

Services

Event processing

Conflict detection

Resolution engine

Replay engine

Audit system

Error handling

Phase 4 — Frontend

Provide:

React architecture

Pages

Components

State management

API integration

Timeline visualization

Conflict visualization

Audit visualization

Phase 5 — Testing

Provide:

Test architecture

Unit tests

Integration tests

Replay tests

Fixtures

Edge cases

Performance tests

Phase 6 — Deployment

Provide:

EC2 deployment architecture

Environment configuration

PostgreSQL setup

Process management

Logging

Backup strategy

Monitoring

Security recommendations

Phase 7 — Documentation

Produce a complete professional README.

Important Engineering Rules

Before writing implementation code:

Identify ambiguities in the requirements.

Identify potential race conditions.

Identify replay consistency problems.

Identify deterministic-decision problems.

Identify database consistency risks.

Explain your proposed solutions.

State your architectural assumptions.

Do not hide complexity behind vague statements such as "use AI" or "use event sourcing."

Explain exactly how the system works.

Do not introduce unnecessary technologies.

Prioritize correctness over premature optimization.

The final architecture should be realistic for an experienced engineering team to implement and should demonstrate strong knowledge of:

Backend architecture

PostgreSQL

Event sourcing concepts

State machines

Concurrency

Idempotency

Deterministic algorithms

Auditability

Temporal reasoning

API design

React architecture

Testing

Production deployment

The final result should look like a professional production-grade system design, while remaining achievable within the stated MVP constraints.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cf935032-c99f-4a88-8fba-cea7aa805f1a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
