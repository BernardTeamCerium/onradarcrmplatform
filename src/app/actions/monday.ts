"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { autoMap, boardIdFrom, defaultStages, deleteSnapshot, fetchBoard, loadSnapshot, saveSnapshot } from "@/lib/monday";
import { getClient, updateDb } from "@/lib/store";
import type { MondayConfig } from "@/lib/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const settings = (id: string, msg: string) => `/admin/clients/${id}/settings?msg=${encodeURIComponent(msg)}#monday`;

async function saveConfig(id: string, cfg: MondayConfig | undefined) {
  await updateDb((db) => {
    const c = db.clients.find((x) => x.id === id);
    if (c) c.monday = cfg;
  });
  revalidatePath("/", "layout");
}

const summary = (n: number, board: string) => `Synced ${n.toLocaleString("en-US")} item${n === 1 ? "" : "s"} from “${board}”.`;

/** Saves the token and board, reads the board, and guesses the column mapping the first time. */
export async function connectMonday(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const client = await getClient(id);
  if (!client) redirect("/admin");
  const token = str(form, "token") || client.monday?.token || "";
  const boardId = boardIdFrom(str(form, "board"));
  if (!token || !boardId) redirect(settings(id, "Enter the Monday.com API token and the board link."));
  let msg: string;
  try {
    const sameBoard = client.monday?.boardId === boardId;
    const snap = await fetchBoard(token, boardId, sameBoard ? client.monday?.columns.stage : undefined);
    await saveSnapshot(id, snap);
    const columns = sameBoard ? client.monday!.columns : autoMap(snap.columns);
    const stages = sameBoard ? { wonStages: client.monday!.wonStages, lostStages: client.monday!.lostStages } : defaultStages(snap.stages);
    msg = summary(snap.items.length, snap.boardName) + (sameBoard ? "" : " Check the column mapping below.");
    await saveConfig(id, { token, boardId, columns, ...stages, lastSyncAt: snap.syncedAt, lastResult: msg });
  } catch (err) {
    msg = (err as Error).message;
  }
  redirect(settings(id, msg));
}

/** Column mapping and which stages count as won (paid) or lost. */
export async function saveMondayMapping(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const client = await getClient(id);
  const cfg = client?.monday;
  if (!cfg) redirect(settings(id, "Connect Monday.com first."));
  const col = (k: string) => str(form, k) || undefined;
  const columns: MondayConfig["columns"] = {
    stage: col("stage"), value: col("value"), actual: col("actual"), owner: col("owner"),
    closeDate: col("closeDate"), source: col("source"), product: col("product"),
  };
  const won = form.getAll("won").map(String);
  const lost = form.getAll("lost").map(String).filter((s) => !won.includes(s));
  let msg = "Monday.com mapping saved.";
  // A different stage column has its own labels, so read the board again.
  if (columns.stage !== cfg.columns.stage) {
    try {
      const snap = await fetchBoard(cfg.token, cfg.boardId, columns.stage);
      await saveSnapshot(id, snap);
      await saveConfig(id, { ...cfg, columns, ...defaultStages(snap.stages), lastSyncAt: snap.syncedAt });
      msg += " The stage column changed, so won and lost stages were reset. Check them below.";
    } catch (err) {
      msg = (err as Error).message;
    }
    redirect(settings(id, msg));
  }
  await saveConfig(id, { ...cfg, columns, wonStages: won, lostStages: lost });
  redirect(settings(id, msg));
}

/** "Refresh from Monday" on the Pipeline tab (team members and admins). */
export async function syncMonday(form: FormData) {
  const user = await requireUser();
  const id = str(form, "clientId");
  if (user.role !== "admin" && user.clientId !== id) throw new Error("Not allowed");
  const client = await getClient(id);
  const back = str(form, "returnTo").startsWith("/") ? str(form, "returnTo").replace(/[?&]msg=[^&]*/, "") : "/dashboard/pipeline";
  let msg: string;
  if (!client?.monday) msg = "Monday.com isn't connected yet.";
  else {
    try {
      const snap = await fetchBoard(client.monday.token, client.monday.boardId, client.monday.columns.stage);
      await saveSnapshot(id, snap);
      msg = summary(snap.items.length, snap.boardName);
      await saveConfig(id, { ...client.monday, lastSyncAt: snap.syncedAt, lastResult: msg });
    } catch (err) {
      msg = (err as Error).message;
    }
  }
  revalidatePath("/", "layout");
  redirect(`${back}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
}

export async function disconnectMonday(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  await saveConfig(id, undefined);
  if (await loadSnapshot(id)) await deleteSnapshot(id);
  redirect(settings(id, "Monday.com disconnected and its synced copy removed."));
}
