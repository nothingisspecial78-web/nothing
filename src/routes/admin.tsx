import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/khazna/AppShell";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    const st = useKhazna.getState();
    if (st.currentRole === "manager") {
      if (st.sessionLoginRole === "admin") {
        st.setCurrentRole("admin");
      } else {
        const slug = st.managerSector || st.sectors[0]?.slug;
        if (slug) {
          throw redirect({ to: "/m/$sectorSlug", params: { sectorSlug: slug } });
        }
      }
    }
    if (st.currentRole === "student") {
      throw redirect({ to: "/app" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <AppShell role="admin">
      <Outlet />
    </AppShell>
  );
}
