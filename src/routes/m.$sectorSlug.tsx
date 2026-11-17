import { Outlet, createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/khazna/AppShell";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/m/$sectorSlug")({
  beforeLoad: ({ params }) => {
    const st = useKhazna.getState();
    const exists = st.sectors.some((s) => s.slug === params.sectorSlug);
    if (!exists && st.sectors.length > 0) {
      throw notFound();
    }
    if (st.currentRole === "admin") {
      if (st.sessionLoginRole === "admin") {
        st.setManagerSector(params.sectorSlug);
        st.setCurrentRole("manager");
      } else {
        throw redirect({ to: "/admin" });
      }
    }
    if (st.currentRole === "student") {
      throw redirect({ to: "/app" });
    }
    if (st.managerSector !== params.sectorSlug) {
      st.setManagerSector(params.sectorSlug);
    }
  },
  component: ManagerLayout,
});

function ManagerLayout() {
  const { sectorSlug } = Route.useParams();
  return (
    <AppShell role="manager" sectorSlug={sectorSlug}>
      <Outlet />
    </AppShell>
  );
}
