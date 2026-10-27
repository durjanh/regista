// Composition root: the one place that creates the HTTP client and hands it to each domain service. Components import
// the service they need (`matchService`, `studioService`, ...); a test can build a service around a fake HttpClient.
import { AxiosHttpClient } from "./http/AxiosHttpClient";
import { BroadcastService } from "./services/BroadcastService";
import { DugoutService } from "./services/DugoutService";
import { ForgeService } from "./services/ForgeService";
import { LanguageService } from "./services/LanguageService";
import { MatchService } from "./services/MatchService";
import { NarrationService } from "./services/NarrationService";
import { ReferenceService } from "./services/ReferenceService";
import { ScoutingService } from "./services/ScoutingService";
import { StudioService } from "./services/StudioService";
import { SystemService } from "./services/SystemService";
import { TruthService } from "./services/TruthService";
import { VideoService } from "./services/VideoService";

export { API_ORIGIN } from "./http/AxiosHttpClient";
export { ApiError } from "./http/ApiError";
export type { HttpClient } from "./http/HttpClient";
export type { StudioAction, StudioNewItem } from "./services/StudioService";

const http = new AxiosHttpClient();

export const broadcastService = new BroadcastService(http);
export const dugoutService = new DugoutService(http);
export const forgeService = new ForgeService(http);
export const languageService = new LanguageService(http);
export const matchService = new MatchService(http);
export const narrationService = new NarrationService(http);
export const referenceService = new ReferenceService(http);
export const scoutingService = new ScoutingService(http);
export const studioService = new StudioService(http);
export const systemService = new SystemService(http);
export const truthService = new TruthService(http);
export const videoService = new VideoService(http);
