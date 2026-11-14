import { z } from "zod";

/**
 * BRU-461 query-boundary contract: pure, IO-free and clock-free.
 *
 * The backend (never the client) derives a tenant scope from server-held
 * memberships, then plans a query only from an explicit dataset allowlist into
 * one fixed, parameterized SELECT template. No SQL text, raw identifiers or
 * tenant IDs are accepted from requests, and no generated SQL is executed.
 * See docs/architecture/postgres-tenant-boundaries.md.
 */

export type QueryBoundaryIssueCode =
  | "INVALID_PRINCIPAL"
  | "NO_TENANT_MEMBERSHIP"
  | "AMBIGUOUS_TENANT_MEMBERSHIP"
  | "UNTRUSTED_SCOPE"
  | "INVALID_ALLOWLIST"
  | "UNTRUSTED_ALLOWLIST"
  | "INVALID_REQUEST"
  | "UNKNOWN_DATASET"
  | "ROLE_NOT_ALLOWED"
  | "UNKNOWN_FIELD"
  | "FIELD_NOT_FILTERABLE"
  | "INVALID_FILTER_VALUE"
  | "INVALID_TIME_RANGE"
  | "TIME_RANGE_TOO_LARGE"
  | "ROW_LIMIT_TOO_LARGE"
  | "UNTRUSTED_PLAN"
  | "INVALID_CONNECTION_CONFIG"
  | "INSECURE_CONNECTION"
  | "PRIVILEGED_ROLE";

/** Messages carry only the code: never request values, rows or credentials. */
export class QueryBoundaryError extends Error {
  constructor(public readonly code: QueryBoundaryIssueCode) {
    super(`Query boundary rejected: ${code}.`);
    this.name = "QueryBoundaryError";
  }
}
function reject(code: QueryBoundaryIssueCode): never {
  throw new QueryBoundaryError(code);
}

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

// ---------------------------------------------------------------------------
// Layer 1: server-issued tenant scope
// ---------------------------------------------------------------------------

const opaqueId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
export const tenantRoleSchema = z.enum(["viewer", "analyst"]);
export const tenantMembershipSchema = z.strictObject({
  principalId: opaqueId,
  tenantId: opaqueId,
  role: tenantRoleSchema,
});
export type TenantMembership = z.infer<typeof tenantMembershipSchema>;
const scopeRequestSchema = z.strictObject({
  principalId: opaqueId,
  tenantId: opaqueId,
});

export type TenantScope = Readonly<{
  kind: "tenant-scope";
  principalId: string;
  tenantId: string;
  role: z.infer<typeof tenantRoleSchema>;
}>;

// Process-local capabilities, as in proposal.ts: cloned, parsed or literal
// objects with the same fields grant nothing.
const issuedScopes = new WeakSet<TenantScope>();

/**
 * Trust boundary. `request.principalId` must come from the backend's
 * authenticated session, and `memberships` from server-held records. Neither
 * may be read from client input. The requested tenant is only selected if the
 * principal holds exactly one membership for it.
 */
export function issueTenantScope(
  request: { principalId: string; tenantId: string },
  memberships: readonly unknown[],
): TenantScope {
  const parsed = scopeRequestSchema.safeParse(request);
  if (!parsed.success) reject("INVALID_PRINCIPAL");
  const records = z.array(tenantMembershipSchema).safeParse(memberships);
  if (!records.success) reject("INVALID_PRINCIPAL");
  const matches = records.data.filter(
    (m) =>
      m.principalId === parsed.data.principalId &&
      m.tenantId === parsed.data.tenantId,
  );
  if (matches.length === 0) reject("NO_TENANT_MEMBERSHIP");
  if (new Set(matches.map((m) => m.role)).size !== 1)
    reject("AMBIGUOUS_TENANT_MEMBERSHIP");
  const scope: TenantScope = Object.freeze({
    kind: "tenant-scope",
    principalId: parsed.data.principalId,
    tenantId: parsed.data.tenantId,
    role: matches[0]!.role,
  });
  issuedScopes.add(scope);
  return scope;
}

export function isIssuedTenantScope(value: unknown): value is TenantScope {
  return (
    typeof value === "object" &&
    value !== null &&
    issuedScopes.has(value as TenantScope)
  );
}

// ---------------------------------------------------------------------------
// Layer 2: explicit dataset allowlist and template-only planner
// ---------------------------------------------------------------------------

/** Lowercase SQL identifier; validated so quoting can never be escaped. */
const sqlIdentifier = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);
/** API names exposed to callers (camelCase); never used as SQL directly. */
const apiName = z.string().regex(/^[a-z][A-Za-z0-9]{0,62}$/);

const fieldSpecSchema = z.strictObject({
  column: sqlIdentifier,
  type: z.enum(["text", "integer", "timestamp"]),
  filterable: z.boolean(),
});
const datasetSpecSchema = z
  .strictObject({
    view: z.strictObject({ schema: sqlIdentifier, name: sqlIdentifier }),
    fields: z
      .record(apiName, fieldSpecSchema)
      .refine((f) => Object.keys(f).length > 0, "fields required"),
    timeField: apiName,
    orderBy: z.array(apiName).min(1).max(4),
    allowedRoles: z.array(tenantRoleSchema).min(1),
    maxRows: z.number().int().min(1).max(100_000),
    timeoutMs: z.number().int().min(50).max(30_000),
    maxRangeDays: z.number().int().min(1).max(3_660),
  })
  .superRefine((spec, ctx) => {
    const time = Object.hasOwn(spec.fields, spec.timeField)
      ? spec.fields[spec.timeField]
      : undefined;
    if (time?.type !== "timestamp")
      ctx.addIssue({
        code: "custom",
        message: "timeField must be a timestamp",
      });
    for (const field of spec.orderBy)
      if (!Object.hasOwn(spec.fields, field))
        ctx.addIssue({ code: "custom", message: "orderBy must be a field" });
    for (const field of Object.values(spec.fields))
      if (field.type === "timestamp" && field.filterable)
        ctx.addIssue({
          code: "custom",
          message: "timestamps are filtered by timeRange only",
        });
  });
export const datasetAllowlistSchema = z.strictObject({
  version: z.literal(1),
  /** The only session setting the executor may set; read by views and RLS. */
  tenantSetting: z.literal("analyticool.tenant_id"),
  datasets: z
    .record(apiName, datasetSpecSchema)
    .refine((d) => Object.keys(d).length > 0, "datasets required"),
});
export type DatasetAllowlist = DeepReadonly<
  z.infer<typeof datasetAllowlistSchema>
>;
const trustedAllowlists = new WeakSet<DatasetAllowlist>();

/** Server configuration only. Parsing freezes it and registers it for planning. */
export function defineDatasetAllowlist(input: unknown): DatasetAllowlist {
  const parsed = datasetAllowlistSchema.safeParse(input);
  if (!parsed.success) reject("INVALID_ALLOWLIST");
  const allowlist = freeze(parsed.data);
  trustedAllowlists.add(allowlist);
  return allowlist;
}

const view = (name: string) => ({ schema: "analyticool_api", name });
const common = {
  allowedRoles: ["viewer", "analyst"],
  maxRows: 10_000,
  timeoutMs: 5_000,
  maxRangeDays: 366,
} as const;
const id = { column: "id", type: "text", filterable: true } as const;
const cents = {
  column: "amount_cents",
  type: "integer",
  filterable: false,
} as const;
const status = { column: "status", type: "text", filterable: true } as const;

/**
 * Synthetic allowlist matching verification/postgres-isolation/schema.sql.
 * Limits are placeholders (BRU-461 decision for review), not product limits.
 */
export const syntheticTenancyAllowlist = defineDatasetAllowlist({
  version: 1,
  tenantSetting: "analyticool.tenant_id",
  datasets: {
    charges: {
      ...common,
      view: view("charges"),
      fields: {
        id,
        amountCents: cents,
        currency: { column: "currency", type: "text", filterable: true },
        createdAt: {
          column: "created_at",
          type: "timestamp",
          filterable: false,
        },
      },
      timeField: "createdAt",
      orderBy: ["createdAt", "id"],
    },
    payments: {
      ...common,
      view: view("payments"),
      fields: {
        id,
        chargeId: { column: "charge_id", type: "text", filterable: true },
        status,
        paidAt: { column: "paid_at", type: "timestamp", filterable: false },
        amountCents: cents,
      },
      timeField: "paidAt",
      orderBy: ["paidAt", "id"],
    },
    refunds: {
      ...common,
      view: view("refunds"),
      fields: {
        id,
        paymentId: { column: "payment_id", type: "text", filterable: true },
        status,
        settledAt: {
          column: "settled_at",
          type: "timestamp",
          filterable: false,
        },
        amountCents: cents,
      },
      timeField: "settledAt",
      orderBy: ["settledAt", "id"],
    },
    processingFees: {
      ...common,
      allowedRoles: ["analyst"],
      view: view("processing_fees"),
      fields: {
        id,
        paymentId: { column: "payment_id", type: "text", filterable: true },
        status,
        postedAt: { column: "posted_at", type: "timestamp", filterable: false },
        amountCents: cents,
      },
      timeField: "postedAt",
      orderBy: ["postedAt", "id"],
    },
  },
});

const requestName = z.string().min(1).max(64);
const filterValue = z.union([
  z.string().max(256),
  z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
]);
/**
 * Strict request shape. There is deliberately no tenantId, sql, table, view,
 * where, orderBy, timeout or column field: unknown keys are rejected.
 */
export const boundedQueryRequestSchema = z.strictObject({
  dataset: requestName,
  fields: z.array(requestName).min(1).max(32),
  timeRange: z.strictObject({
    startInclusive: z.iso.datetime({ offset: true }),
    endExclusive: z.iso.datetime({ offset: true }),
  }),
  filters: z
    .array(
      z.discriminatedUnion("op", [
        z.strictObject({
          field: requestName,
          op: z.literal("eq"),
          value: filterValue,
        }),
        z.strictObject({
          field: requestName,
          op: z.literal("in"),
          values: z.array(filterValue).min(1).max(100),
        }),
      ]),
    )
    .max(8)
    .optional(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
export type BoundedQueryRequest = z.infer<typeof boundedQueryRequestSchema>;

export type BoundedQueryPlan = Readonly<{
  kind: "bounded-query-plan";
  dataset: string;
  /** Fixed template; identifiers come only from the allowlist. */
  text: string;
  /** Every request value, in placeholder order; the last is LIMIT rowCap+1. */
  values: readonly (string | number)[];
  /** Selected API field names, in output order. */
  fields: readonly string[];
  /** Bound by the executor into `set_config(setting, value, true)`; never in text. */
  tenant: Readonly<{ setting: "analyticool.tenant_id"; value: string }>;
  rowCap: number;
  timeoutMs: number;
  lockTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
}>;
const issuedPlans = new WeakSet<BoundedQueryPlan>();

const quote = (identifier: string) => `"${identifier}"`;
const DAY_MS = 86_400_000;

/**
 * Compile a request into the single supported template:
 * SELECT <allowlisted cols> FROM <allowlisted view>
 * WHERE <time range> [AND <allowlisted equality filters>]
 * ORDER BY <allowlisted order> LIMIT rowCap+1.
 */
export function planBoundedQuery(
  scope: TenantScope,
  request: unknown,
  allowlist: DatasetAllowlist = syntheticTenancyAllowlist,
): BoundedQueryPlan {
  if (!isIssuedTenantScope(scope)) reject("UNTRUSTED_SCOPE");
  if (!trustedAllowlists.has(allowlist)) reject("UNTRUSTED_ALLOWLIST");
  const parsed = boundedQueryRequestSchema.safeParse(request);
  if (!parsed.success) reject("INVALID_REQUEST");
  const req = parsed.data;
  if (!Object.hasOwn(allowlist.datasets, req.dataset))
    reject("UNKNOWN_DATASET");
  const spec = allowlist.datasets[req.dataset]!;
  if (!spec.allowedRoles.includes(scope.role)) reject("ROLE_NOT_ALLOWED");
  const field = (name: string) => {
    if (!Object.hasOwn(spec.fields, name)) reject("UNKNOWN_FIELD");
    return spec.fields[name]!;
  };
  if (new Set(req.fields).size !== req.fields.length) reject("INVALID_REQUEST");
  const select = req.fields.map(
    (name) => `${quote(field(name).column)} AS ${quote(name)}`,
  );

  const start = Date.parse(req.timeRange.startInclusive);
  const end = Date.parse(req.timeRange.endExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    reject("INVALID_TIME_RANGE");
  if (end - start > spec.maxRangeDays * DAY_MS) reject("TIME_RANGE_TOO_LARGE");

  const values: (string | number)[] = [];
  const param = (value: string | number, cast: string) => {
    values.push(value);
    return `$${values.length}::${cast}`;
  };
  const time = quote(field(spec.timeField).column);
  const where = [
    `${time} >= ${param(new Date(start).toISOString(), "timestamptz")}`,
    `${time} < ${param(new Date(end).toISOString(), "timestamptz")}`,
  ];
  for (const filter of req.filters ?? []) {
    const target = field(filter.field);
    if (!target.filterable) reject("FIELD_NOT_FILTERABLE");
    const cast = target.type === "integer" ? "bigint" : "text";
    const typed = (value: string | number) => {
      if (
        target.type === "integer"
          ? typeof value !== "number"
          : typeof value !== "string"
      )
        reject("INVALID_FILTER_VALUE");
      return value;
    };
    const column = quote(target.column);
    if (filter.op === "eq")
      where.push(`${column} = ${param(typed(filter.value), cast)}`);
    else
      where.push(
        `${column} IN (${filter.values.map((v) => param(typed(v), cast)).join(", ")})`,
      );
  }

  if (req.limit !== undefined && req.limit > spec.maxRows)
    reject("ROW_LIMIT_TOO_LARGE");
  const rowCap = req.limit ?? spec.maxRows;
  const order = spec.orderBy
    .map((name) => quote(field(name).column))
    .join(", ");
  const limit = param(rowCap + 1, "bigint");
  const text =
    `SELECT ${select.join(", ")} FROM ${quote(spec.view.schema)}.${quote(spec.view.name)}` +
    ` WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit}`;

  const plan: BoundedQueryPlan = freeze({
    kind: "bounded-query-plan",
    dataset: req.dataset,
    text,
    values,
    fields: [...req.fields],
    tenant: { setting: allowlist.tenantSetting, value: scope.tenantId },
    rowCap,
    timeoutMs: spec.timeoutMs,
    lockTimeoutMs: Math.min(1_000, spec.timeoutMs),
    idleInTransactionTimeoutMs: spec.timeoutMs + 1_000,
  }) as BoundedQueryPlan;
  issuedPlans.add(plan);
  return plan;
}

/** Executors run only plans produced by planBoundedQuery in this process. */
export function isIssuedQueryPlan(value: unknown): value is BoundedQueryPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    issuedPlans.has(value as BoundedQueryPlan)
  );
}

export type RowCapOutcome<T> =
  | Readonly<{ status: "complete"; rows: readonly T[] }>
  | Readonly<{ status: "blocked"; code: "ROW_CAP_EXCEEDED"; rowCap: number }>;

/** More rows than the cap blocks the result; it is never silently truncated. */
export function evaluateRowCap<T>(
  rows: readonly T[],
  rowCap: number,
): RowCapOutcome<T> {
  if (!Number.isSafeInteger(rowCap) || rowCap < 1)
    throw new RangeError("rowCap must be a positive integer");
  return rows.length > rowCap
    ? Object.freeze({ status: "blocked", code: "ROW_CAP_EXCEEDED", rowCap })
    : Object.freeze({ status: "complete", rows });
}

// ---------------------------------------------------------------------------
// Connection settings
// ---------------------------------------------------------------------------

export const connectionConfigSchema = z.strictObject({
  mode: z.enum(["production", "local-test"]),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  database: z.string().min(1).max(63),
  user: z.string().min(1).max(63),
  password: z.string().min(1).max(1_024),
  sslmode: z.enum([
    "disable",
    "allow",
    "prefer",
    "require",
    "verify-ca",
    "verify-full",
  ]),
  sslrootcert: z.string().min(1).max(4_096).optional(),
});
export type ConnectionConfig = Readonly<z.infer<typeof connectionConfigSchema>>;

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
/** Roles that are superusers, cluster admins or table owners on common hosts. */
const privilegedRoles = new Set([
  "postgres",
  "root",
  "admin",
  "rdsadmin",
  "rds_superuser",
  "azure_superuser",
  "azure_pg_admin",
  "cloudsqlsuperuser",
  "cloudsqladmin",
  "supabase_admin",
  "supabase_auth_admin",
  "service_role",
  "analyticool_owner",
]);

/**
 * Checks static connection settings. Production requires `verify-full` TLS;
 * `local-test` is only accepted for loopback hosts. Privileged or owner role
 * names are rejected. The database still has to enforce least privilege; the
 * isolation suite asserts that from the catalog. Errors never echo the config.
 */
export function validateConnectionConfig(input: unknown): ConnectionConfig {
  const parsed = connectionConfigSchema.safeParse(input);
  if (!parsed.success) reject("INVALID_CONNECTION_CONFIG");
  const config = parsed.data;
  const user = config.user.toLowerCase();
  if (
    privilegedRoles.has(user) ||
    user.endsWith("_owner") ||
    user.endsWith("_admin")
  )
    reject("PRIVILEGED_ROLE");
  if (config.mode === "production" && config.sslmode !== "verify-full")
    reject("INSECURE_CONNECTION");
  if (
    config.mode === "local-test" &&
    !loopbackHosts.has(config.host.toLowerCase())
  )
    reject("INSECURE_CONNECTION");
  return Object.freeze(config);
}

/** Human-readable descriptor for logs; the password is never included. */
export function describeConnection(config: ConnectionConfig): string {
  return `postgresql://${config.user}:***@${config.host}:${config.port}/${config.database}?sslmode=${config.sslmode}`;
}
