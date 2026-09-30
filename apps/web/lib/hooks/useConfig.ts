"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchConfig } from "@/lib/api";

/** App-wide config (addresses, houseMM, flagship). Cached; never hardcode addresses. */
export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => fetchConfig(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}
