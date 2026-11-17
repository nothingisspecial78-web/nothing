import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminLogin } from "@/apps/super-admin/SuperAdminLogin";

export const Route = createFileRoute("/super-admin/login")({
  head: () => ({
    meta: [
      { title: "Super Admin Portal — Khazna" },
      { name: "description", content: "Multi-tenant platform administration login." },
    ],
  }),
  component: SuperAdminLogin,
});
