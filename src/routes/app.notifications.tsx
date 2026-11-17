import { createFileRoute } from "@tanstack/react-router";
import { Bell, CheckCheck } from "lucide-react";
import { Btn } from "@/components/khazna/btn";
import { Chip, EmptyState, GlassCard, PageHeader } from "@/components/khazna/primitives";
import { timeAgo } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/app/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Khazna Student" },
      { name: "description", content: "Fee notices, dues alerts, and payment confirmations." },
    ],
  }),
  component: StudentNotificationsPage,
});

function StudentNotificationsPage() {
  const notices = useKhazna((s) => s.notices);
  const markRead = useKhazna((s) => s.markRead);
  const markAllRead = useKhazna((s) => s.markAllRead);
  const unread = notices.reduce((c, n) => c + (n.read ? 0 : 1), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Account"
        title="Notifications"
        description={unread ? `${unread} unread notice${unread === 1 ? "" : "s"}.` : "All caught up."}
        actions={
          unread > 0 ? (
            <Btn variant="soft" data-ai-id="notifications-mark-all-btn" onClick={markAllRead}>
              <CheckCheck /> Mark all read
            </Btn>
          ) : undefined
        }
      />

      <GlassCard>
        {notices.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" body="Fee dues and payment receipts will appear here." />
        ) : (
          <ul className="divide-y divide-hairline">
            {notices.map((n) => (
              <li
                key={n.id}
                className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between ${
                  n.read ? "opacity-75" : "bg-primary/5"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Chip tone={n.kind === "credit" ? "credit" : n.kind === "due" ? "debit" : "info"}>
                      {n.kind}
                    </Chip>
                    <span className="font-medium text-foreground">{n.title}</span>
                    {!n.read && <span className="size-2 rounded-full bg-primary" />}
                  </div>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                  <div className="text-xs text-subtle">{timeAgo(n.at)}</div>
                </div>
                {!n.read && (
                  <Btn variant="ghost" size="sm" data-ai-id={`notice-read-${n.id}`} onClick={() => markRead(n.id)}>
                    Mark read
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
