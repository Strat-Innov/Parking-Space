// Compile-time proof that the hand-written domain types in `types.ts` still
// match the Prisma models generated from prisma/schema.prisma, field for field.
//
// This file has no runtime effect — it exists so that `tsc --noEmit` fails if
// the schema gains, loses, or retypes a column without the domain type being
// updated to match. Without it, a hand-written type could silently drift from
// the database and every test would still pass while the types lied.
//
// It is the only file outside src/lib/data/prisma-repositories.ts that imports
// @prisma/client, and it imports types only.

import type {
  User,
  ParkingRequest,
  RateTableEntry,
  ParkingSpace,
  RequestEvent,
  AccessRequest,
  AccessRequestEvent,
} from "@prisma/client";

import type {
  UserRecord,
  ParkingRequestRecord,
  RateTableEntryRecord,
  ParkingSpaceRecord,
  RequestEventRecord,
  AccessRequestRecord,
  AccessRequestEventRecord,
} from "./types";

/** Resolves to `true` only when A and B have exactly the same shape. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// A `never` on any line below is a real drift between schema.prisma and
// types.ts — fix the domain type, do not weaken this check.
const _user: Exact<User, UserRecord> = true;
const _parkingRequest: Exact<ParkingRequest, ParkingRequestRecord> = true;
const _rateTableEntry: Exact<RateTableEntry, RateTableEntryRecord> = true;
const _parkingSpace: Exact<ParkingSpace, ParkingSpaceRecord> = true;
const _requestEvent: Exact<RequestEvent, RequestEventRecord> = true;
const _accessRequest: Exact<AccessRequest, AccessRequestRecord> = true;
const _accessRequestEvent: Exact<AccessRequestEvent, AccessRequestEventRecord> = true;

export const DOMAIN_TYPES_MATCH_SCHEMA = [
  _user,
  _parkingRequest,
  _rateTableEntry,
  _parkingSpace,
  _requestEvent,
  _accessRequest,
  _accessRequestEvent,
] as const;
