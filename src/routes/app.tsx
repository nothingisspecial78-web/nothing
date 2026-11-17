import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/khazna/AppShell";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/app")({
  beforeLoad: () => {
    const st = useKhazna.getState();
    if (st.currentRole === "admin") {
      throw redirect({ to: "/admin" });
    }
    if (st.currentRole === "manager") {
      const slug = st.managerSector || st.sectors[0]?.slug;
      if (slug) {
        throw redirect({ to: "/m/$sectorSlug", params: { sectorSlug: slug } });
      }
      throw redirect({ to: "/admin" });
    }
  },
  component: StudentLayout,
});

function StudentLayout() {
  return (
    <AppShell role="student">
      <Outlet />
    </AppShell>
  );
}
