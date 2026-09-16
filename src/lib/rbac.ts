import { AttachmentEntity, Role } from "@/generated/prisma/enums";

export type ModuleId =
  | "dashboard"
  | "customers"
  | "suppliers"
  | "requests"
  | "quotations"
  | "orders"
  | "procurement"
  | "fulfillment"
  | "delivery"
  | "finance"
  | "products"
  | "inventory"
  | "reports"
  | "settings";

export type Access = "none" | "view" | "manage";

export type NavItem = {
  id: ModuleId;
  label: string;
  href: string;
  group: "Overview" | "Sales" | "Supply" | "Operations" | "Finance" | "Master data" | "Admin";
  /** lucide-react icon name; resolved by the sidebar. */
  icon: string;
};

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", group: "Overview", icon: "LayoutDashboard" },
  { id: "customers", label: "Customers", href: "/customers", group: "Sales", icon: "Building2" },
  { id: "requests", label: "Requests", href: "/requests", group: "Sales", icon: "Inbox" },
  { id: "quotations", label: "Quotations", href: "/quotations", group: "Sales", icon: "FileText" },
  { id: "orders", label: "Orders", href: "/orders", group: "Sales", icon: "ClipboardList" },
  { id: "suppliers", label: "Suppliers", href: "/suppliers", group: "Supply", icon: "Truck" },
  { id: "procurement", label: "Procurement", href: "/procurement", group: "Supply", icon: "ShoppingCart" },
  { id: "fulfillment", label: "Fulfillment", href: "/fulfillment", group: "Operations", icon: "Hammer" },
  { id: "delivery", label: "Delivery", href: "/delivery", group: "Operations", icon: "PackageCheck" },
  { id: "finance", label: "Finance", href: "/finance/invoices", group: "Finance", icon: "Wallet" },
  { id: "products", label: "Products", href: "/products", group: "Master data", icon: "Boxes" },
  { id: "inventory", label: "Inventory", href: "/inventory", group: "Master data", icon: "Warehouse" },
  { id: "reports", label: "Reports", href: "/reports", group: "Overview", icon: "BarChart3" },
  { id: "settings", label: "Settings", href: "/settings", group: "Admin", icon: "Settings" },
];

const ALL: ModuleId[] = NAV_ITEMS.map((item) => item.id);

function access(manage: ModuleId[], view: ModuleId[]): Record<ModuleId, Access> {
  const result = {} as Record<ModuleId, Access>;
  for (const id of ALL) result[id] = "none";
  for (const id of view) result[id] = "view";
  for (const id of manage) result[id] = "manage";
  return result;
}

const ACCESS_BY_ROLE: Record<Role, Record<ModuleId, Access>> = {
  OWNER: access(ALL, []),
  // Managers run the shop floor but company-level settings stay with the owner.
  MANAGER: access(
    ALL.filter((id) => id !== "settings"),
    ["settings"],
  ),
  SALES: access(
    ["customers", "requests", "quotations"],
    ["dashboard", "orders", "products", "reports"],
  ),
  PROCUREMENT: access(
    ["suppliers", "procurement", "products", "inventory"],
    ["dashboard", "orders", "reports"],
  ),
  OPERATIONS: access(
    ["fulfillment", "delivery", "inventory"],
    ["dashboard", "orders", "products", "suppliers"],
  ),
  FINANCE: access(
    ["finance"],
    ["dashboard", "orders", "customers", "delivery", "reports"],
  ),
};

export function moduleAccess(role: Role, moduleId: ModuleId): Access {
  return ACCESS_BY_ROLE[role]?.[moduleId] ?? "none";
}

export function canView(role: Role, moduleId: ModuleId): boolean {
  return moduleAccess(role, moduleId) !== "none";
}

export function canManage(role: Role, moduleId: ModuleId): boolean {
  return moduleAccess(role, moduleId) === "manage";
}

export function canApprove(role: Role): boolean {
  return role === Role.OWNER || role === Role.MANAGER;
}

export function canSeeAllActivity(role: Role): boolean {
  return role === Role.OWNER || role === Role.MANAGER;
}

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => canView(role, item.id));
}

/** Maps an auditable record type to the module that owns it, for permission checks. */
export function moduleForEntity(entity: AttachmentEntity): ModuleId {
  switch (entity) {
    case AttachmentEntity.CUSTOMER:
    case AttachmentEntity.CONTACT:
      return "customers";
    case AttachmentEntity.SUPPLIER:
      return "suppliers";
    case AttachmentEntity.REQUEST:
      return "requests";
    case AttachmentEntity.QUOTATION:
      return "quotations";
    case AttachmentEntity.ORDER:
      return "orders";
    case AttachmentEntity.RFQ:
    case AttachmentEntity.PURCHASE_ORDER:
    case AttachmentEntity.GOODS_RECEIPT:
      return "procurement";
    case AttachmentEntity.WORK_ORDER:
    case AttachmentEntity.PRODUCTION_ORDER:
    case AttachmentEntity.SUBCONTRACT:
      return "fulfillment";
    case AttachmentEntity.DELIVERY_ORDER:
      return "delivery";
    case AttachmentEntity.INVOICE:
    case AttachmentEntity.PAYMENT:
      return "finance";
    case AttachmentEntity.PRODUCT:
      return "products";
    default:
      return "dashboard";
  }
}

export function groupNav(items: NavItem[]): { group: NavItem["group"]; items: NavItem[] }[] {
  const groups: NavItem["group"][] = [
    "Overview",
    "Sales",
    "Supply",
    "Operations",
    "Finance",
    "Master data",
    "Admin",
  ];
  return groups
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter((entry) => entry.items.length > 0);
}
