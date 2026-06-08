/** Register this device for push once, from the authenticated shell. */

import { useEffect } from "react";

import { registerForPush } from "./push";

export function usePushRegistration(): void {
  useEffect(() => {
    void registerForPush();
  }, []);
}
