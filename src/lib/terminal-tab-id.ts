export interface TerminalTabBeatIdParts {
  prefix: string | null;
  localId: string;
}

export function splitTerminalTabBeatId(id: string): TerminalTabBeatIdParts {
  const separatorIndex = id.indexOf("-");
  if (separatorIndex <= 0 || separatorIndex >= id.length - 1) {
    return { prefix: null, localId: id };
  }
  return {
    prefix: id.slice(0, separatorIndex),
    localId: id.slice(separatorIndex + 1),
  };
}
