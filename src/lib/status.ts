export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

/**
 * Enum values are unique enough across models that one lookup table is enough.
 * `tone` drives badge colours; `label` is what the user reads.
 */
const META: Record<string, { label: string; tone: Tone }> = {
  // generic
  DRAFT: { label: "Draft", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
  COMPLETED: { label: "Completed", tone: "success" },

  // customer / supplier
  ACTIVE: { label: "Active", tone: "success" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  BLACKLISTED: { label: "Blacklisted", tone: "danger" },

  // requests
  NEW: { label: "New", tone: "info" },
  PREPARING_QUOTATION: { label: "Preparing Quotation", tone: "info" },
  QUOTATION_SENT: { label: "Quotation Sent", tone: "accent" },
  WAITING_RESPONSE: { label: "Waiting Response", tone: "warning" },
  CLOSED_WON: { label: "Closed — Won", tone: "success" },
  CLOSED_LOST: { label: "Closed — Lost", tone: "danger" },

  PRICE_TOO_HIGH: { label: "Price too high", tone: "neutral" },
  OUT_OF_STOCK: { label: "Out of stock", tone: "neutral" },
  CANCELLED_BY_CUSTOMER: { label: "Cancelled by customer", tone: "neutral" },
  NO_BUDGET: { label: "No budget", tone: "neutral" },
  LOST_TO_COMPETITOR: { label: "Lost to competitor", tone: "neutral" },
  DELIVERY_TOO_LONG: { label: "Delivery too long", tone: "neutral" },
  OTHER: { label: "Other", tone: "neutral" },

  // quotation
  WAITING_APPROVAL: { label: "Waiting Approval", tone: "warning" },
  SENT: { label: "Sent", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "neutral" },

  // Layer 1 tracker (pengganti spreadsheet) — status versi sheet lama.
  WAITING_PO: { label: "Waiting PO", tone: "warning" },
  PO_RECEIVED: { label: "PO Received", tone: "success" },
  LOST: { label: "Lost", tone: "neutral" },
  TO_SOURCE: { label: "To Source", tone: "neutral" },
  ORDERED: { label: "Ordered", tone: "info" },

  // orders
  CONFIRMED: { label: "Confirmed", tone: "info" },
  IN_PROGRESS: { label: "In Progress", tone: "accent" },
  FULFILLED: { label: "Fulfilled", tone: "success" },

  NOT_SOURCED: { label: "Not Sourced", tone: "neutral" },
  SOURCING: { label: "Sourcing", tone: "warning" },
  SOURCED: { label: "Sourced", tone: "success" },

  // procurement
  PENDING_APPROVAL: { label: "Pending Approval", tone: "warning" },
  PARTIAL_RECEIVED: { label: "Partially Received", tone: "warning" },
  RECEIVED: { label: "Received", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
  INVITED: { label: "Invited", tone: "neutral" },
  RESPONDED: { label: "Responded", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
  SELECTED: { label: "Selected", tone: "success" },
  PARTIAL: { label: "Partial", tone: "warning" },
  FULL: { label: "Full", tone: "success" },

  // fulfillment
  SCHEDULED: { label: "Scheduled", tone: "info" },
  QC: { label: "In QC", tone: "warning" },
  REWORK: { label: "Rework", tone: "warning" },
  PENDING: { label: "Pending", tone: "neutral" },
  DONE: { label: "Done", tone: "success" },
  PASS: { label: "Pass", tone: "success" },
  FAIL: { label: "Fail", tone: "danger" },
  ASSIGNED: { label: "Assigned", tone: "info" },
  INSPECTION: { label: "Inspection", tone: "warning" },

  // delivery
  NOT_READY: { label: "Not Ready", tone: "neutral" },
  READY_TO_SHIP: { label: "Ready to Ship", tone: "info" },
  IN_DELIVERY: { label: "In Delivery", tone: "accent" },
  DELIVERED: { label: "Delivered", tone: "success" },

  // finance
  PARTIALLY_PAID: { label: "Partially Paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  OVERDUE: { label: "Overdue", tone: "danger" },

  // notifications / approvals
  PENDING_SEND: { label: "Pending", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },

  // roles
  OWNER: { label: "Owner", tone: "accent" },
  MANAGER: { label: "Manager", tone: "accent" },
  SALES: { label: "Sales / CS", tone: "info" },
  PROCUREMENT: { label: "Procurement", tone: "info" },
  OPERATIONS: { label: "Operations", tone: "info" },
  FINANCE: { label: "Finance", tone: "info" },

  // request sources
  EMAIL: { label: "Email", tone: "neutral" },
  WHATSAPP: { label: "WhatsApp", tone: "success" },
  PHONE: { label: "Phone", tone: "neutral" },
  MANUAL: { label: "Manual", tone: "neutral" },

  // line types
  PRODUCT: { label: "Product", tone: "info" },
  SERVICE: { label: "Service", tone: "accent" },
  LABOR: { label: "Labor", tone: "accent" },
  PACKAGE: { label: "Package", tone: "info" },
  CUSTOM: { label: "Custom", tone: "neutral" },
};

export function statusMeta(value: string | null | undefined): { label: string; tone: Tone } {
  if (!value) return { label: "—", tone: "neutral" };
  return META[value] ?? { label: titleize(value), tone: "neutral" };
}

export function titleize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function enumOptions<T extends Record<string, string>>(source: T): { value: string; label: string }[] {
  return Object.values(source).map((value) => ({ value, label: statusMeta(value).label }));
}
