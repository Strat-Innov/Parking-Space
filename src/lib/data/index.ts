// The application's single entry point to persistence.
//
// Phase 1 has exactly one implementation. Phase 3 adds a SharePoint one and
// selects between them here; nothing above this module needs to change when it
// does, which is the entire point of the boundary.

import { prismaRepositories } from "./prisma-repositories";
import type { Repositories } from "./repositories";

export const repos: Repositories = prismaRepositories;

export type * from "./types";
export type {
  BookingWindowQuery,
  CreateWithEvent,
  ParkingRequestTransition,
  AccessRequestTransition,
  Repositories,
  TransitionPlan,
  TransitionReads,
  TransitionSpec,
} from "./repositories";
