// The API's service-contract settings: REST paths, API versions, limits and timeouts. One definition for every
// profile; the names are the API's environment variables (backend/api/app/config.py, backend/api/.env.example).
// Override any of them per environment without a code change, as KEY=value pairs separated by ';' (plain text, so
// it survives azd's substitution into a parameters file), e.g.:
//   azd env set API_SERVICE_SETTINGS 'AZURE_CONTENT_SAFETY_API_VERSION=2025-09-15-preview;HTTP_TIMEOUT_S=30'
// Container Apps sets them on the container; the AKS profiles output them for the Kubernetes manifests.

@export()
@description('Defaults, matching the Azure APIs this build is tested against.')
func apiServiceSettingsDefaults() object => ({
  AZURE_COGNITIVE_SCOPE: 'https://cognitiveservices.azure.com/.default'   // Entra token scope for Azure OpenAI and the AI Services REST APIs
  AZURE_TOKEN_REFRESH_MARGIN_S: '120'   // refresh a cached token this many seconds before it expires
  HTTP_TIMEOUT_S: '20'   // timeout of the shared REST client (app/integrations/http.py)
  AZURE_OPENAI_API_PATH: '/openai/v1/'   // Azure OpenAI v1 API path
  AZURE_OPENAI_TIMEOUT_S: '40'
  AZURE_OPENAI_MAX_RETRIES: '2'
  AZURE_SPEECH_TTS_URL: 'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1'   // {region} = AZURE_AI_SERVICES_REGION
  AZURE_SPEECH_OUTPUT_FORMAT: 'audio-24khz-48kbitrate-mono-mp3'
  AZURE_TRANSLATOR_PATH: '/translator/text/v3.0/translate'   // on the AI Services custom-domain endpoint
  AZURE_TRANSLATOR_API_VERSION: '3.0'
  AZURE_CONTENT_SAFETY_API_VERSION: '2024-09-01'
  AZURE_CONTENT_SAFETY_ANALYZE_PATH: '/contentsafety/text:analyze'
  AZURE_CONTENT_SAFETY_SHIELD_PATH: '/contentsafety/text:shieldPrompt'   // Prompt Shields
  AZURE_CONTENT_SAFETY_MAX_CHARS: '9000'   // text sent to Content Safety / Prompt Shields is cut to this length
  AZURE_CONTENT_SAFETY_BLOCK_SEVERITY: '4'   // a category at or above this severity flags the text
  BROADCAST_VIEWER_COUNT_INTERVAL_S: '5'   // how often the live broadcast's viewer count is refreshed
  BROADCAST_VIEWER_COUNT_MAX: '10000'   // the viewer count stops here and shows N+ (keeps 100,000 viewers cheap)
  REGISTA_VIDEO_SAFE: '0'   // '1' replaces trademarked competition names with generic labels (recorded demos)
  ONELAKE_DFS_ENDPOINT: 'https://onelake.dfs.fabric.microsoft.com'   // Microsoft Fabric OneLake (ADLS Gen2 DFS)
})

@export()
@description('Overrides from "KEY=value;KEY=value" (empty = none). A value may contain "=", not ";".')
func parseApiServiceSettings(spec string) object => toObject(
  filter(map(split(spec, ';'), pair => trim(pair)), pair => contains(pair, '=')),
  pair => trim(substring(pair, 0, indexOf(pair, '='))),
  pair => substring(pair, indexOf(pair, '=') + 1))

@export()
@description('Defaults with the environment\'s overrides applied (every value a string, as environment variables are).')
func apiServiceSettings(overrides object) object => union(apiServiceSettingsDefaults(), overrides)

@export()
@description('The settings as container environment variables.')
func apiServiceEnv(overrides object) array => map(items(apiServiceSettings(overrides)), s => { name: s.key, value: string(s.value) })
