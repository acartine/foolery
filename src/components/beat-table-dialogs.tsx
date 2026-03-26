"use client";

import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import type {
  CascadeDescendant,
} from "@/lib/cascade-close";
import { NotesDialog } from "@/components/notes-dialog";
import {
  CascadeCloseDialog,
} from "@/components/cascade-close-dialog";
import {
  repoPathForBeat,
} from "@/components/beat-table-mutations";

export function BeatTableDialogs({
  notesBeat,
  notesOpen,
  setNotesOpen,
  handleUpdateBeat,
  cascadeOpen,
  setCascadeOpen,
  cascadeBeat,
  setCascadeBeat,
  cascadeDesc,
  setCascadeDesc,
  cascadeLoading,
  handleCascadeClose,
}: {
  notesBeat: Beat | null;
  notesOpen: boolean;
  setNotesOpen: (v: boolean) => void;
  handleUpdateBeat: (args: {
    id: string;
    fields: UpdateBeatInput;
    repoPath?: string;
  }) => void;
  cascadeOpen: boolean;
  setCascadeOpen: (v: boolean) => void;
  cascadeBeat: Beat | null;
  setCascadeBeat: (b: Beat | null) => void;
  cascadeDesc: CascadeDescendant[];
  setCascadeDesc: (
    d: CascadeDescendant[],
  ) => void;
  cascadeLoading: boolean;
  handleCascadeClose: (id: string) => void;
}) {
  return (
    <>
      <NotesDialog
        beat={notesBeat}
        open={notesOpen}
        onOpenChange={setNotesOpen}
        onUpdate={(id, fields) =>
          handleUpdateBeat({
            id,
            fields,
            repoPath: repoPathForBeat(
              notesBeat ?? undefined,
            ),
          })
        }
      />
      <CascadeCloseDialog
        open={cascadeOpen}
        onOpenChange={(open) => {
          setCascadeOpen(open);
          if (!open) {
            setCascadeBeat(null);
            setCascadeDesc([]);
          }
        }}
        parentTitle={cascadeBeat?.title ?? ""}
        descendants={cascadeDesc}
        loading={cascadeLoading}
        onConfirm={() => {
          if (cascadeBeat) {
            handleCascadeClose(cascadeBeat.id);
          }
        }}
      />
    </>
  );
}
