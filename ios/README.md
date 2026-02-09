# vLLM Playground - iOS App

Native iOS client for remote vLLM servers. Connects directly to vLLM's OpenAI-compatible API.

## Features

- **Chat** with streaming responses, markdown rendering, conversation persistence
- **VLM** (Vision Language Model) - attach images from photos or camera
- **vLLM-Omni** - image generation, text-to-speech, audio generation
- **Benchmark** - lightweight performance testing with TTFT, TPS, latency metrics
- **Multi-server** profile management with health monitoring
- **Dark/Light** theme support

## Requirements

- macOS with Xcode 16+
- iOS 17+ deployment target
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) for project generation

## Setup

1. Install XcodeGen:

```bash
brew install xcodegen
```

2. Generate the Xcode project:

```bash
cd ios/vllm-playground
./generate_project.sh
```

3. Open in Xcode:

```bash
open vllm-playground.xcodeproj
```

4. Select a simulator or device, then build and run (Cmd+R).

## Usage

1. Go to the **Servers** tab and add your remote vLLM server URL (e.g. `http://gpu-server:8000`)
2. Optionally add an API key if your server requires authentication
3. Switch to the **Chat** tab and start a conversation
4. Use the image picker button to attach images for VLM queries

## Architecture

```
vllm-playground/
├── App/            # App entry point, root navigation
├── Models/         # SwiftData models (ServerProfile, Conversation, Message, BenchmarkResult)
├── Services/       # API clients (VLLMAPIClient, OmniAPIClient, BenchmarkService, KeychainService)
├── ViewModels/     # Observable view models for each feature
├── Views/          # SwiftUI views organized by feature
│   ├── Chat/       # Chat interface, messages, input, settings
│   ├── Servers/    # Server profile management
│   ├── Omni/       # Image generation, TTS, gallery
│   ├── Benchmark/  # Performance testing UI
│   └── Settings/   # App settings
├── Utilities/      # Markdown renderer, extensions
└── Resources/      # Assets, Info.plist
```

The app communicates directly with vLLM servers via their OpenAI-compatible REST API (`/v1/chat/completions`, `/v1/models`, `/health`). No backend middleware is needed.

## Note on App Transport Security

The app allows arbitrary HTTP loads (configured in Info.plist) to support connecting to local network vLLM servers that may not use HTTPS. For production deployment, consider restricting this to specific domains.
