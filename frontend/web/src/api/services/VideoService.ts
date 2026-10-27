import type { HttpClient } from "../http/HttpClient";
import type { VideoRead, VideoTeams } from "../types";

/** The reasoning model reading frames sampled from any football clip. */
export class VideoService {
  constructor(private readonly http: HttpClient) {}

  /** One batch of frames ({t in seconds, JPEG data URL}); `teams` keeps "a" and "b" the same teams across batches. */
  read(frames: { t: number; image: string }[], teams?: VideoTeams) {
    return this.http.post<VideoRead>("/video/read", { frames, teams });
  }
}
