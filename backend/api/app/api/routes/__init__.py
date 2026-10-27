"""One APIRouter per domain; `ROUTERS` is the order main.create_app includes them."""

from . import dugout, forge, language, matches, narration, realtime, reference, scouting, studio, system, truth, video

ROUTERS = [system.router, reference.router, matches.router, realtime.router, narration.router, language.router,
           studio.router, truth.router, scouting.router, dugout.router, forge.router, video.router]
