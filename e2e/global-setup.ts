import { seed } from "./seed";

/** One seeded workspace, rebuilt from scratch before every run so the tests start level. */
export default function globalSetup(): void {
  seed(process.env.DATA_DIR ?? "./data-e2e");
}
