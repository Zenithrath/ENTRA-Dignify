import { Tabs } from "@/components/ui/tabs";

const TABS = [
  { id: "company", label: "Company", href: "/settings" },
  { id: "users", label: "Users & roles", href: "/settings/users" },
  { id: "numbering", label: "Document numbers", href: "/settings/numbering" },
  { id: "templates", label: "Templates", href: "/settings/templates" },
  { id: "workflow", label: "Workflow & modules", href: "/settings/workflow" },
  { id: "approvals", label: "Approvals", href: "/settings/approvals" },
  { id: "profile", label: "My profile", href: "/settings/profile" },
];

export function SettingsTabs({ active }: { active: string }) {
  return <Tabs items={TABS} active={active} />;
}
