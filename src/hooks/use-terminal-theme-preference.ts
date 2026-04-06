"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchSettings, patchSettings } from "@/lib/settings-api";
import type { FoolerySettings } from "@/lib/schemas";

const QUERY_KEY = ["settings", "terminalLightTheme"] as const;
const SETTINGS_QUERY_KEY = ["settings"] as const;

export interface TerminalThemePreference {
  lightTheme: boolean;
  isLoading: boolean;
  isSaving: boolean;
  setLightTheme: (value: boolean) => void;
}

export function useTerminalThemePreference(): TerminalThemePreference {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const result = await fetchSettings();
      if (result.ok && result.data) {
        return result.data.terminalLightTheme ?? false;
      }
      return false;
    },
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (lightTheme: boolean) => {
      const result = await patchSettings({ terminalLightTheme: lightTheme });
      if (!result.ok) {
        throw new Error(result.error ?? "Failed to save theme preference");
      }
      return result.data;
    },
    onMutate: async (lightTheme: boolean) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      await queryClient.cancelQueries({
        queryKey: SETTINGS_QUERY_KEY,
      });

      const previousLightTheme =
        queryClient.getQueryData<boolean>(QUERY_KEY);
      const previousSettings =
        queryClient.getQueryData<FoolerySettings>(
          SETTINGS_QUERY_KEY,
        );

      queryClient.setQueryData(QUERY_KEY, lightTheme);

      if (previousSettings) {
        queryClient.setQueryData<FoolerySettings>(
          SETTINGS_QUERY_KEY,
          {
            ...previousSettings,
            terminalLightTheme: lightTheme,
          },
        );
      }

      return {
        previousLightTheme,
        previousSettings,
      };
    },
    onError: (_error, _lightTheme, context) => {
      queryClient.setQueryData(
        QUERY_KEY,
        context?.previousLightTheme ?? false,
      );

      if (context?.previousSettings) {
        queryClient.setQueryData(
          SETTINGS_QUERY_KEY,
          context.previousSettings,
        );
      }

      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onSuccess: (settings) => {
      if (!settings) return;
      queryClient.setQueryData(
        QUERY_KEY,
        settings.terminalLightTheme ?? false,
      );
      queryClient.setQueryData(
        SETTINGS_QUERY_KEY,
        settings,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: SETTINGS_QUERY_KEY,
      });
    },
  });

  return {
    lightTheme: data ?? false,
    isLoading,
    isSaving: mutation.isPending,
    setLightTheme: mutation.mutate,
  };
}
