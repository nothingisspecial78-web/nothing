import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";
import { Route as LoginRoute } from "./routes/login";
import { Route as SuperAdminLoginRoute } from "./routes/super-admin.login";
import { Route as SuperAdminIndexRoute } from "./routes/super-admin.index";
import { Route as VerifyTokenRoute } from "./routes/v.$token";
import { Route as UpgradeRoute } from "./routes/upgrade";

import { Route as AdminRoute } from "./routes/admin";
import { Route as AdminIndexRoute } from "./routes/admin.index";
import { Route as AdminAuditRoute } from "./routes/admin.audit";
import { Route as AdminIssuedReportsRoute } from "./routes/admin.issued-reports";
import { Route as AdminStudentsIndexRoute } from "./routes/admin.students.index";
import { Route as AdminStudentsImportRoute } from "./routes/admin.students.import";
import { Route as AdminAdminsRoute } from "./routes/admin.admins";
import { Route as AdminInstitutionRoute } from "./routes/admin.institution";
import { Route as AdminSectorsRoute } from "./routes/admin.sectors";

import { Route as ManagerSectorRoute } from "./routes/m.$sectorSlug";
import { Route as ManagerSectorIndexRoute } from "./routes/m.$sectorSlug.index";
import { Route as ManagerSectorLedgerRoute } from "./routes/m.$sectorSlug.ledger";
import { Route as ManagerSectorBulkRoute } from "./routes/m.$sectorSlug.bulk";
import { Route as ManagerSectorReportsRoute } from "./routes/m.$sectorSlug.reports";
import { Route as ManagerSectorBatchesRoute } from "./routes/m.$sectorSlug.batches";

import { Route as AppRoute } from "./routes/app";
import { Route as AppIndexRoute } from "./routes/app.index";
import { Route as AppSectorRoute } from "./routes/app.s.$sectorSlug";
import { Route as AppNotificationsRoute } from "./routes/app.notifications";
import { Route as AppProfileRoute } from "./routes/app.profile";

const IndexRouteWithParent = IndexRoute.update({
  id: "/",
  path: "/",
  getParentRoute: () => RootRoute,
} as any);

const LoginRouteWithParent = LoginRoute.update({
  id: "/login",
  path: "/login",
  getParentRoute: () => RootRoute,
} as any);

const SuperAdminLoginRouteWithParent = SuperAdminLoginRoute.update({
  id: "/super-admin/login",
  path: "/super-admin/login",
  getParentRoute: () => RootRoute,
} as any);

const SuperAdminIndexRouteWithParent = SuperAdminIndexRoute.update({
  id: "/super-admin/",
  path: "/super-admin",
  getParentRoute: () => RootRoute,
} as any);

const VerifyTokenRouteWithParent = VerifyTokenRoute.update({
  id: "/v/$token",
  path: "/v/$token",
  getParentRoute: () => RootRoute,
} as any);

const UpgradeRouteWithParent = UpgradeRoute.update({
  id: "/upgrade",
  path: "/upgrade",
  getParentRoute: () => RootRoute,
} as any);

const AdminRouteWithParent = AdminRoute.update({
  id: "/admin",
  path: "/admin",
  getParentRoute: () => RootRoute,
} as any);

const AdminIndexRouteWithParent = AdminIndexRoute.update({
  id: "/admin/",
  path: "/",
  getParentRoute: () => AdminRouteWithParent,
} as any);

const AdminAuditRouteWithParent = AdminAuditRoute.update({
  id: "/admin/audit",
  path: "/audit",
  getParentRoute: () => AdminRouteWithParent,
} as any);

const AdminIssuedReportsRouteWithParent = AdminIssuedReportsRoute.update({
  id: "/admin/issued-reports",
  path: "/issued-reports",
  getParentRoute: () => AdminRouteWithParent,
} as any);

const AdminStudentsIndexRouteWithParent = AdminStudentsIndexRoute.update({
  id: "/admin/students/",
  path: "/students",
  getParentRoute: () => AdminRouteWithParent,
} as any);

const AdminStudentsImportRouteWithParent = AdminStudentsImportRoute.update({
  id: "/admin/students/import",
  path: "/students/import",
  getParentRoute: () => AdminRouteWithParent,
} as any);

const AdminAdminsRouteWithParent = AdminAdminsRoute.update({
  id: "/admin/admins",
  path: "/admins",
  getParentRoute: () => AdminRouteWithParent,
} as any);

const AdminInstitutionRouteWithParent = AdminInstitutionRoute.update({
  id: "/admin/institution",
  path: "/institution",
  getParentRoute: () => AdminRouteWithParent,
} as any);

const AdminSectorsRouteWithParent = AdminSectorsRoute.update({
  id: "/admin/sectors",
  path: "/sectors",
  getParentRoute: () => AdminRouteWithParent,
} as any);

const AdminRouteTree = AdminRouteWithParent.addChildren([
  AdminIndexRouteWithParent,
  AdminAuditRouteWithParent,
  AdminIssuedReportsRouteWithParent,
  AdminStudentsIndexRouteWithParent,
  AdminStudentsImportRouteWithParent,
  AdminAdminsRouteWithParent,
  AdminInstitutionRouteWithParent,
  AdminSectorsRouteWithParent,
]);

const ManagerSectorRouteWithParent = ManagerSectorRoute.update({
  id: "/m/$sectorSlug",
  path: "/m/$sectorSlug",
  getParentRoute: () => RootRoute,
} as any);

const ManagerSectorIndexRouteWithParent = ManagerSectorIndexRoute.update({
  id: "/m/$sectorSlug/",
  path: "/",
  getParentRoute: () => ManagerSectorRouteWithParent,
} as any);

const ManagerSectorLedgerRouteWithParent = ManagerSectorLedgerRoute.update({
  id: "/m/$sectorSlug/ledger",
  path: "/ledger",
  getParentRoute: () => ManagerSectorRouteWithParent,
} as any);

const ManagerSectorBulkRouteWithParent = ManagerSectorBulkRoute.update({
  id: "/m/$sectorSlug/bulk",
  path: "/bulk",
  getParentRoute: () => ManagerSectorRouteWithParent,
} as any);

const ManagerSectorReportsRouteWithParent = ManagerSectorReportsRoute.update({
  id: "/m/$sectorSlug/reports",
  path: "/reports",
  getParentRoute: () => ManagerSectorRouteWithParent,
} as any);

const ManagerSectorBatchesRouteWithParent = ManagerSectorBatchesRoute.update({
  id: "/m/$sectorSlug/batches",
  path: "/batches",
  getParentRoute: () => ManagerSectorRouteWithParent,
} as any);

const ManagerRouteTree = ManagerSectorRouteWithParent.addChildren([
  ManagerSectorIndexRouteWithParent,
  ManagerSectorLedgerRouteWithParent,
  ManagerSectorBulkRouteWithParent,
  ManagerSectorReportsRouteWithParent,
  ManagerSectorBatchesRouteWithParent,
]);

const AppRouteWithParent = AppRoute.update({
  id: "/app",
  path: "/app",
  getParentRoute: () => RootRoute,
} as any);

const AppIndexRouteWithParent = AppIndexRoute.update({
  id: "/app/",
  path: "/",
  getParentRoute: () => AppRouteWithParent,
} as any);

const AppSectorRouteWithParent = AppSectorRoute.update({
  id: "/app/s/$sectorSlug",
  path: "/s/$sectorSlug",
  getParentRoute: () => AppRouteWithParent,
} as any);

const AppNotificationsRouteWithParent = AppNotificationsRoute.update({
  id: "/app/notifications",
  path: "/notifications",
  getParentRoute: () => AppRouteWithParent,
} as any);

const AppProfileRouteWithParent = AppProfileRoute.update({
  id: "/app/profile",
  path: "/profile",
  getParentRoute: () => AppRouteWithParent,
} as any);

const AppRouteTree = AppRouteWithParent.addChildren([
  AppIndexRouteWithParent,
  AppSectorRouteWithParent,
  AppNotificationsRouteWithParent,
  AppProfileRouteWithParent,
]);

const routeTree = RootRoute.addChildren([
  IndexRouteWithParent,
  LoginRouteWithParent,
  SuperAdminLoginRouteWithParent,
  SuperAdminIndexRouteWithParent,
  VerifyTokenRouteWithParent,
  UpgradeRouteWithParent,
  AdminRouteTree,
  ManagerRouteTree,
  AppRouteTree,
]);

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
  });
}

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/": {
      id: "/";
      path: "/";
      fullPath: "/";
      preLoaderRoute: typeof IndexRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/login": {
      id: "/login";
      path: "/login";
      fullPath: "/login";
      preLoaderRoute: typeof LoginRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/super-admin/login": {
      id: "/super-admin/login";
      path: "/super-admin/login";
      fullPath: "/super-admin/login";
      preLoaderRoute: typeof SuperAdminLoginRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/super-admin/": {
      id: "/super-admin/";
      path: "/super-admin";
      fullPath: "/super-admin";
      preLoaderRoute: typeof SuperAdminIndexRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/v/$token": {
      id: "/v/$token";
      path: "/v/$token";
      fullPath: "/v/$token";
      preLoaderRoute: typeof VerifyTokenRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/upgrade": {
      id: "/upgrade";
      path: "/upgrade";
      fullPath: "/upgrade";
      preLoaderRoute: typeof UpgradeRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/admin": {
      id: "/admin";
      path: "/admin";
      fullPath: "/admin";
      preLoaderRoute: typeof AdminRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/admin/": {
      id: "/admin/";
      path: "/";
      fullPath: "/admin";
      preLoaderRoute: typeof AdminIndexRouteWithParent;
      parentRoute: typeof AdminRouteWithParent;
    };
    "/admin/audit": {
      id: "/admin/audit";
      path: "/audit";
      fullPath: "/admin/audit";
      preLoaderRoute: typeof AdminAuditRouteWithParent;
      parentRoute: typeof AdminRouteWithParent;
    };
    "/admin/issued-reports": {
      id: "/admin/issued-reports";
      path: "/issued-reports";
      fullPath: "/admin/issued-reports";
      preLoaderRoute: typeof AdminIssuedReportsRouteWithParent;
      parentRoute: typeof AdminRouteWithParent;
    };
    "/admin/students/": {
      id: "/admin/students/";
      path: "/students";
      fullPath: "/admin/students";
      preLoaderRoute: typeof AdminStudentsIndexRouteWithParent;
      parentRoute: typeof AdminRouteWithParent;
    };
    "/admin/students/import": {
      id: "/admin/students/import";
      path: "/students/import";
      fullPath: "/admin/students/import";
      preLoaderRoute: typeof AdminStudentsImportRouteWithParent;
      parentRoute: typeof AdminRouteWithParent;
    };
    "/admin/admins": {
      id: "/admin/admins";
      path: "/admins";
      fullPath: "/admin/admins";
      preLoaderRoute: typeof AdminAdminsRouteWithParent;
      parentRoute: typeof AdminRouteWithParent;
    };
    "/admin/institution": {
      id: "/admin/institution";
      path: "/institution";
      fullPath: "/admin/institution";
      preLoaderRoute: typeof AdminInstitutionRouteWithParent;
      parentRoute: typeof AdminRouteWithParent;
    };
    "/admin/sectors": {
      id: "/admin/sectors";
      path: "/sectors";
      fullPath: "/admin/sectors";
      preLoaderRoute: typeof AdminSectorsRouteWithParent;
      parentRoute: typeof AdminRouteWithParent;
    };
    "/m/$sectorSlug": {
      id: "/m/$sectorSlug";
      path: "/m/$sectorSlug";
      fullPath: "/m/$sectorSlug";
      preLoaderRoute: typeof ManagerSectorRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/m/$sectorSlug/": {
      id: "/m/$sectorSlug/";
      path: "/";
      fullPath: "/m/$sectorSlug";
      preLoaderRoute: typeof ManagerSectorIndexRouteWithParent;
      parentRoute: typeof ManagerSectorRouteWithParent;
    };
    "/m/$sectorSlug/ledger": {
      id: "/m/$sectorSlug/ledger";
      path: "/ledger";
      fullPath: "/m/$sectorSlug/ledger";
      preLoaderRoute: typeof ManagerSectorLedgerRouteWithParent;
      parentRoute: typeof ManagerSectorRouteWithParent;
    };
    "/m/$sectorSlug/bulk": {
      id: "/m/$sectorSlug/bulk";
      path: "/bulk";
      fullPath: "/m/$sectorSlug/bulk";
      preLoaderRoute: typeof ManagerSectorBulkRouteWithParent;
      parentRoute: typeof ManagerSectorRouteWithParent;
    };
    "/m/$sectorSlug/reports": {
      id: "/m/$sectorSlug/reports";
      path: "/reports";
      fullPath: "/m/$sectorSlug/reports";
      preLoaderRoute: typeof ManagerSectorReportsRouteWithParent;
      parentRoute: typeof ManagerSectorRouteWithParent;
    };
    "/m/$sectorSlug/batches": {
      id: "/m/$sectorSlug/batches";
      path: "/batches";
      fullPath: "/m/$sectorSlug/batches";
      preLoaderRoute: typeof ManagerSectorBatchesRouteWithParent;
      parentRoute: typeof ManagerSectorRouteWithParent;
    };
    "/app": {
      id: "/app";
      path: "/app";
      fullPath: "/app";
      preLoaderRoute: typeof AppRouteWithParent;
      parentRoute: typeof RootRoute;
    };
    "/app/": {
      id: "/app/";
      path: "/";
      fullPath: "/app";
      preLoaderRoute: typeof AppIndexRouteWithParent;
      parentRoute: typeof AppRouteWithParent;
    };
    "/app/s/$sectorSlug": {
      id: "/app/s/$sectorSlug";
      path: "/s/$sectorSlug";
      fullPath: "/app/s/$sectorSlug";
      preLoaderRoute: typeof AppSectorRouteWithParent;
      parentRoute: typeof AppRouteWithParent;
    };
    "/app/notifications": {
      id: "/app/notifications";
      path: "/notifications";
      fullPath: "/app/notifications";
      preLoaderRoute: typeof AppNotificationsRouteWithParent;
      parentRoute: typeof AppRouteWithParent;
    };
    "/app/profile": {
      id: "/app/profile";
      path: "/profile";
      fullPath: "/app/profile";
      preLoaderRoute: typeof AppProfileRouteWithParent;
      parentRoute: typeof AppRouteWithParent;
    };
  }

  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
