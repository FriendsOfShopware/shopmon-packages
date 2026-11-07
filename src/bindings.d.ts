import type { InferEnv, UnwrapConfig } from "cf/config";
import type config from "../cloudflare.config";

type Config = UnwrapConfig<typeof config>;
type ConfigBindings = InferEnv<UnwrapConfig<Config["worker"]>>;

declare global {
  interface CloudflareBindings extends ConfigBindings {}
}
