// =============================================================================
// vLLM-Omni Module
// Handles vLLM-Omni multimodal generation functionality
// Reuses patterns from: guidellm.js, mcp.js, app.js
// =============================================================================

/**
 * Initialize the vLLM-Omni module
 * @param {VLLMWebUI} ui - The main UI instance
 */
export function initOmniModule(ui) {
    OmniModule.ui = ui;
    injectMethods(ui);

    // Check availability using already-fetched data from ui
    OmniModule.available = ui.omniAvailable || false;
    OmniModule.version = ui.omniVersion || null;

    // Pass through ModelScope availability from main app (already detected on startup)
    OmniModule.modelscopeInstalled = ui.modelscopeInstalled || false;
    OmniModule.modelscopeVersion = ui.modelscopeVersion || null;

    // Pass through container mode availability from main app
    OmniModule.containerModeAvailable = ui.containerModeAvailable || false;

    // Make OmniModule globally accessible for retry button
    window.OmniModule = OmniModule;

    console.log('vLLM-Omni module initialized, available:', OmniModule.available);
    console.log('vLLM-Omni: ModelScope installed:', OmniModule.modelscopeInstalled);
}

/**
 * Inject vLLM-Omni methods into the UI class
 */
function injectMethods(ui) {
    console.log('[Omni] Injecting methods into ui...');
    ui.startOmniServer = OmniModule.startServer.bind(OmniModule);
    ui.stopOmniServer = OmniModule.stopServer.bind(OmniModule);
    ui.generateOmniImage = OmniModule.generateImage.bind(OmniModule);
    ui.loadOmniTemplate = OmniModule.loadTemplate.bind(OmniModule);
    ui.onOmniViewActivated = OmniModule.onViewActivated.bind(OmniModule);
    // Recipe methods
    ui.openOmniRecipesModal = OmniModule.openRecipesModal.bind(OmniModule);
    ui.closeOmniRecipesModal = OmniModule.closeRecipesModal.bind(OmniModule);
    ui.applyOmniRecipe = OmniModule.applyRecipe.bind(OmniModule);
    console.log('[Omni] Methods injected. applyOmniRecipe:', typeof ui.applyOmniRecipe);
}

/**
 * vLLM-Omni Module object with all methods
 */
export const OmniModule = {
    ui: null,
    available: false,
    version: null,
    serverRunning: false,
    serverReady: false,  // True when API endpoint is actually responding
    healthCheckInterval: null,
    statusPollInterval: null,  // Status polling interval (same as main vLLM Server)
    templateLoaded: false,
    currentModelType: 'image',
    currentModelSource: 'hub',
    uploadedImage: null,
    chatHistory: [],
    logWebSocket: null,  // WebSocket for log streaming
    commandManuallyEdited: false,  // Track if user manually edited command preview

    // Prompt templates organized by model type
    promptTemplatesByType: {
        // =====================================================================
        // IMAGE GENERATION TEMPLATES
        // =====================================================================
        image: {
            groups: [
                {
                    label: 'Landscape',
                    templates: [
                        { id: 'landscape-sunset', name: 'Sunset Beach' },
                        { id: 'landscape-mountain', name: 'Mountain Vista' },
                        { id: 'landscape-forest', name: 'Enchanted Forest' }
                    ]
                },
                {
                    label: 'Portrait',
                    templates: [
                        { id: 'portrait-professional', name: 'Professional Headshot' },
                        { id: 'portrait-artistic', name: 'Artistic Portrait' },
                        { id: 'portrait-fantasy', name: 'Fantasy Character' }
                    ]
                },
                {
                    label: 'Art & Abstract',
                    templates: [
                        { id: 'art-abstract', name: 'Abstract Art' },
                        { id: 'art-surreal', name: 'Surrealist Dream' },
                        { id: 'art-cyberpunk', name: 'Cyberpunk City' }
                    ]
                },
                {
                    label: 'Nature & Animals',
                    templates: [
                        { id: 'nature-wildlife', name: 'Wildlife Scene' },
                        { id: 'nature-flowers', name: 'Flower Garden' },
                        { id: 'nature-underwater', name: 'Underwater World' }
                    ]
                },
                {
                    label: 'Product & Object',
                    templates: [
                        { id: 'product-tech', name: 'Tech Product' },
                        { id: 'product-food', name: 'Food Photography' }
                    ]
                }
            ],
            data: {
                'landscape-sunset': {
                    prompt: 'Beautiful sunset over ocean waves, vibrant orange and purple sky, golden hour lighting, photorealistic, 4k, detailed clouds, calm waters reflecting the sky',
                    negative: 'blurry, low quality, artifacts, oversaturated, cartoon, painting'
                },
                'landscape-mountain': {
                    prompt: 'Majestic snow-capped mountain peaks at golden hour, crystal clear alpine lake reflection, dramatic clouds, professional nature photography, 8k resolution',
                    negative: 'blurry, artificial, cartoon, drawing, oversaturated, people'
                },
                'landscape-forest': {
                    prompt: 'Enchanted misty forest with sunbeams filtering through ancient trees, moss-covered ground, magical atmosphere, ethereal lighting, fantasy landscape',
                    negative: 'blurry, dark, muddy colors, artificial, low quality'
                },
                'portrait-professional': {
                    prompt: 'Professional business headshot, confident expression, soft studio lighting, shallow depth of field, clean background, high-end corporate photography',
                    negative: 'blurry, distorted face, extra fingers, deformed, amateur, harsh lighting'
                },
                'portrait-artistic': {
                    prompt: 'Artistic portrait with dramatic lighting, Rembrandt style, emotional expression, fine art photography, rich shadows and highlights, cinematic mood',
                    negative: 'blurry, flat lighting, distorted features, low quality, amateur'
                },
                'portrait-fantasy': {
                    prompt: 'Fantasy character portrait, elven features, ethereal beauty, flowing silver hair, glowing eyes, ornate jewelry, magical aura, detailed fantasy art',
                    negative: 'blurry, bad anatomy, extra limbs, distorted face, low quality'
                },
                'art-abstract': {
                    prompt: 'Abstract fluid art, vibrant swirling colors, dynamic composition, modern art style, blue and gold palette, high contrast, artistic masterpiece',
                    negative: 'blurry, muddy colors, low contrast, boring, simple'
                },
                'art-surreal': {
                    prompt: 'Surrealist dreamscape, melting clocks, floating objects, impossible architecture, Salvador Dali inspired, vivid imagination, otherworldly atmosphere',
                    negative: 'blurry, realistic, mundane, boring, low quality'
                },
                'art-cyberpunk': {
                    prompt: 'Cyberpunk city at night, neon lights reflecting on wet streets, flying cars, holographic advertisements, futuristic architecture, rain, atmospheric',
                    negative: 'blurry, daytime, nature, low quality, simple'
                },
                'nature-wildlife': {
                    prompt: 'Majestic lion in African savanna, golden hour lighting, professional wildlife photography, detailed fur, intense gaze, natural habitat, National Geographic style',
                    negative: 'blurry, cartoon, artificial, zoo, low quality'
                },
                'nature-flowers': {
                    prompt: 'Beautiful flower garden in full bloom, macro photography, morning dew on petals, vibrant colors, soft bokeh background, botanical beauty',
                    negative: 'blurry, wilted, artificial, low quality, oversaturated'
                },
                'nature-underwater': {
                    prompt: 'Vibrant coral reef underwater scene, tropical fish, crystal clear water, sunbeams penetrating the surface, marine life photography, colorful sea creatures',
                    negative: 'blurry, murky water, low quality, artificial'
                },
                'product-tech': {
                    prompt: 'Sleek modern smartphone on reflective surface, studio lighting, minimalist background, product photography, sharp details, professional commercial shot',
                    negative: 'blurry, cluttered, amateur, low quality, dirty'
                },
                'product-food': {
                    prompt: 'Gourmet dish on elegant plate, professional food photography, appetizing presentation, fresh ingredients, soft natural lighting, restaurant quality',
                    negative: 'blurry, unappetizing, messy, low quality, artificial'
                }
            }
        },

        // =====================================================================
        // VIDEO GENERATION TEMPLATES
        // =====================================================================
        video: {
            groups: [
                {
                    label: 'Nature & Scenery',
                    templates: [
                        { id: 'video-ocean', name: 'Ocean Waves' },
                        { id: 'video-forest', name: 'Forest Walk' },
                        { id: 'video-clouds', name: 'Timelapse Clouds' }
                    ]
                },
                {
                    label: 'Action & Motion',
                    templates: [
                        { id: 'video-running', name: 'Running Person' },
                        { id: 'video-dancing', name: 'Dancing' },
                        { id: 'video-sports', name: 'Sports Action' }
                    ]
                },
                {
                    label: 'Urban & City',
                    templates: [
                        { id: 'video-cityscape', name: 'City Timelapse' },
                        { id: 'video-traffic', name: 'Traffic Flow' },
                        { id: 'video-neon', name: 'Neon Streets' }
                    ]
                },
                {
                    label: 'Animals',
                    templates: [
                        { id: 'video-bird', name: 'Bird Flying' },
                        { id: 'video-cat', name: 'Cat Playing' },
                        { id: 'video-fish', name: 'Fish Swimming' }
                    ]
                },
                {
                    label: 'Abstract & Creative',
                    templates: [
                        { id: 'video-particles', name: 'Particle Flow' },
                        { id: 'video-liquid', name: 'Liquid Motion' },
                        { id: 'video-morph', name: 'Shape Morphing' }
                    ]
                }
            ],
            data: {
                'video-ocean': {
                    prompt: 'Cinematic ocean waves crashing on rocky shore, golden sunset light, slow motion water spray, peaceful and dramatic, 4K quality, steady camera',
                    negative: 'static, blurry, low quality, shaky camera, fast motion'
                },
                'video-forest': {
                    prompt: 'Smooth walking through enchanted forest, sunbeams through trees, floating dust particles, magical atmosphere, steady dolly shot, cinematic',
                    negative: 'shaky, fast movement, blurry, low quality, static'
                },
                'video-clouds': {
                    prompt: 'Timelapse of dramatic clouds moving across sky, golden hour colors, smooth motion, epic atmosphere, professional cinematography',
                    negative: 'static, jerky, low quality, night time, no movement'
                },
                'video-running': {
                    prompt: 'Athletic person running in slow motion, professional sports photography style, dynamic movement, muscles in motion, cinematic lighting',
                    negative: 'static, blurry, distorted body, low quality, unnatural movement'
                },
                'video-dancing': {
                    prompt: 'Graceful dancer performing ballet, flowing movements, elegant pose transitions, studio lighting, slow motion, professional dance video',
                    negative: 'jerky movements, distorted limbs, blurry, low quality, static'
                },
                'video-sports': {
                    prompt: 'Basketball player making a slam dunk, slow motion action, dynamic angle, sports arena lighting, intense moment, professional sports footage',
                    negative: 'static, blurry, distorted body, low quality, no action'
                },
                'video-cityscape': {
                    prompt: 'Timelapse of modern city skyline day to night transition, lights turning on, traffic moving, clouds passing, professional drone footage',
                    negative: 'static, blurry, low quality, no movement, empty streets'
                },
                'video-traffic': {
                    prompt: 'Smooth traffic flow on highway at dusk, car lights creating trails, aerial view, timelapse effect, urban beauty, cinematic',
                    negative: 'static, blurry, low quality, empty road, daytime'
                },
                'video-neon': {
                    prompt: 'Walking through neon-lit cyberpunk streets at night, rain reflections, holographic signs, futuristic atmosphere, smooth camera movement',
                    negative: 'daytime, static, blurry, low quality, no lights'
                },
                'video-bird': {
                    prompt: 'Majestic eagle soaring through blue sky, slow motion wing movements, detailed feathers, freedom and grace, wildlife documentary style',
                    negative: 'static, blurry, distorted wings, low quality, on ground'
                },
                'video-cat': {
                    prompt: 'Cute cat playing with toy, natural movements, playful behavior, soft lighting, home environment, adorable expressions, smooth video',
                    negative: 'static, sleeping, blurry, distorted, low quality'
                },
                'video-fish': {
                    prompt: 'Colorful tropical fish swimming in coral reef, crystal clear water, smooth underwater footage, marine life documentary, vibrant colors',
                    negative: 'static, murky water, blurry, low quality, dead fish'
                },
                'video-particles': {
                    prompt: 'Abstract particle system flowing and swirling, bioluminescent colors, smooth motion, mesmerizing patterns, digital art, calming movement',
                    negative: 'static, chaotic, low quality, boring, no movement'
                },
                'video-liquid': {
                    prompt: 'Abstract liquid metal morphing and flowing, chrome reflections, smooth slow motion, satisfying movement, modern art, mesmerizing',
                    negative: 'static, choppy, low quality, no reflection, boring'
                },
                'video-morph': {
                    prompt: 'Geometric shapes smoothly morphing into each other, colorful transitions, abstract art, satisfying loop, modern animation style',
                    negative: 'static, jerky, low quality, boring, no transition'
                }
            }
        },

        // =====================================================================
        // TTS (TEXT-TO-SPEECH) TEMPLATES
        // =====================================================================
        tts: {
            groups: [
                {
                    label: 'Introductions',
                    templates: [
                        { id: 'tts-playground-intro', name: 'vLLM Playground Intro' },
                        { id: 'tts-welcome', name: 'Welcome Message' },
                        { id: 'tts-demo', name: 'TTS Demo' }
                    ]
                },
                {
                    label: 'Professional',
                    templates: [
                        { id: 'tts-news', name: 'News Anchor Style' },
                        { id: 'tts-presentation', name: 'Presentation Opening' },
                        { id: 'tts-tutorial', name: 'Tutorial Narration' }
                    ]
                },
                {
                    label: 'Creative',
                    templates: [
                        { id: 'tts-story', name: 'Story Narration' },
                        { id: 'tts-podcast', name: 'Podcast Intro' }
                    ]
                }
            ],
            data: {
                'tts-playground-intro': {
                    prompt: 'Welcome to vLLM Playground! I am your AI assistant, powered by vLLM and vLLM-Omni. This playground allows you to experiment with state-of-the-art language models, generate stunning images, create videos, and now, synthesize natural-sounding speech like this. Whether you are a researcher, developer, or AI enthusiast, vLLM Playground provides an intuitive interface to explore the latest in generative AI. Let us get started!',
                    negative: ''
                },
                'tts-welcome': {
                    prompt: 'Hello and welcome! Thank you for using our text-to-speech service. I can help you convert any text into natural, human-like speech. Feel free to type anything you would like me to say, and I will do my best to deliver it with clarity and expression.',
                    negative: ''
                },
                'tts-demo': {
                    prompt: 'This is a demonstration of the Qwen3 text-to-speech model. Notice how the speech flows naturally, with appropriate pauses, intonation, and rhythm. The model can handle various types of content, from conversational dialogue to formal announcements.',
                    negative: ''
                },
                'tts-news': {
                    prompt: 'Good evening. In today\'s top stories: Researchers have made significant breakthroughs in artificial intelligence, with new models demonstrating unprecedented capabilities in language understanding and generation. Meanwhile, tech companies continue to invest heavily in AI infrastructure. Stay tuned for more updates.',
                    negative: ''
                },
                'tts-presentation': {
                    prompt: 'Good morning everyone, and thank you for joining today\'s presentation. We have an exciting agenda ahead of us, covering the latest developments in our field. I\'ll be walking you through the key findings and their implications for our work going forward.',
                    negative: ''
                },
                'tts-tutorial': {
                    prompt: 'In this tutorial, we\'ll walk through the process step by step. First, make sure you have all the necessary prerequisites installed. Then, follow along as I guide you through each stage of the setup. Don\'t worry if you encounter any issues - I\'ll address common problems along the way.',
                    negative: ''
                },
                'tts-story': {
                    prompt: 'Once upon a time, in a land far away, there lived a curious inventor who dreamed of building machines that could think and speak. Day after day, she worked in her workshop, combining gears and circuits until one morning, her creation spoke its first words.',
                    negative: ''
                },
                'tts-podcast': {
                    prompt: 'Hey everyone, welcome back to the show! I\'m your host, and today we have an incredible episode lined up for you. We\'re going to dive deep into some fascinating topics that I know you\'re going to love. So grab your coffee, get comfortable, and let\'s get into it!',
                    negative: ''
                }
            }
        },

        // =====================================================================
        // AUDIO GENERATION TEMPLATES (MUSIC/SFX)
        // =====================================================================
        audio: {
            groups: [
                {
                    label: 'Music',
                    templates: [
                        { id: 'audio-ambient', name: 'Ambient Music' },
                        { id: 'audio-piano', name: 'Piano Melody' },
                        { id: 'audio-electronic', name: 'Electronic Beat' }
                    ]
                },
                {
                    label: 'Nature Sounds',
                    templates: [
                        { id: 'audio-rain', name: 'Rain & Thunder' },
                        { id: 'audio-forest', name: 'Forest Ambiance' },
                        { id: 'audio-ocean', name: 'Ocean Waves' }
                    ]
                },
                {
                    label: 'Sound Effects',
                    templates: [
                        { id: 'audio-whoosh', name: 'Swoosh/Whoosh' },
                        { id: 'audio-impact', name: 'Impact Sound' },
                        { id: 'audio-notification', name: 'Notification Chime' }
                    ]
                },
                {
                    label: 'Ambient',
                    templates: [
                        { id: 'audio-cafe', name: 'Coffee Shop' },
                        { id: 'audio-city', name: 'City Background' },
                        { id: 'audio-space', name: 'Space Ambiance' }
                    ]
                }
            ],
            data: {
                'audio-ambient': {
                    prompt: 'Calm ambient music, soft synthesizer pads, relaxing atmosphere, gentle melody, meditation music, peaceful and soothing',
                    negative: 'loud, harsh, aggressive, fast tempo, vocals, distorted'
                },
                'audio-piano': {
                    prompt: 'Beautiful piano melody, emotional and touching, classical style, soft dynamics, clear notes, concert hall acoustics',
                    negative: 'harsh, distorted, electronic, loud, fast, aggressive'
                },
                'audio-electronic': {
                    prompt: 'Modern electronic beat, punchy drums, deep bass, catchy synth melody, dance music, energetic and uplifting',
                    negative: 'acoustic, slow, boring, muddy, distorted, no rhythm'
                },
                'audio-rain': {
                    prompt: 'Gentle rain falling on window, distant thunder, cozy atmosphere, relaxing rain sounds, peaceful ambiance for sleep',
                    negative: 'heavy storm, loud, harsh, sudden sounds, music'
                },
                'audio-forest': {
                    prompt: 'Forest ambiance with birds singing, gentle breeze through leaves, distant stream, peaceful nature sounds, immersive environment',
                    negative: 'loud, urban sounds, music, harsh, artificial'
                },
                'audio-ocean': {
                    prompt: 'Ocean waves gently crashing on beach, seagulls in distance, relaxing coastal sounds, peaceful seaside ambiance',
                    negative: 'storm, loud, harsh, music, artificial, sudden sounds'
                },
                'audio-whoosh': {
                    prompt: 'Smooth swoosh sound effect, clean and professional, cinematic transition sound, fast movement audio, modern UI sound',
                    negative: 'harsh, distorted, long, music, vocals'
                },
                'audio-impact': {
                    prompt: 'Deep cinematic impact sound, powerful and dramatic, movie trailer style, bass-heavy hit, professional sound design',
                    negative: 'weak, thin, long, music, vocals, distorted'
                },
                'audio-notification': {
                    prompt: 'Pleasant notification chime, clear and melodic, friendly UI sound, short and recognizable, modern app notification',
                    negative: 'harsh, annoying, long, complex, music, distorted'
                },
                'audio-cafe': {
                    prompt: 'Coffee shop ambiance, gentle background chatter, clinking cups, espresso machine sounds, cozy atmosphere, work-friendly background',
                    negative: 'loud, music, harsh, clear speech, empty, silence'
                },
                'audio-city': {
                    prompt: 'Urban city background sounds, distant traffic, pedestrians walking, city life ambiance, daytime urban atmosphere',
                    negative: 'quiet, nature, music, harsh, isolated sounds'
                },
                'audio-space': {
                    prompt: 'Deep space ambiance, mysterious cosmic sounds, ethereal drone, sci-fi atmosphere, otherworldly and immersive',
                    negative: 'music, harsh, loud, earth sounds, vocals'
                }
            }
        }
    },

    // Legacy promptTemplates getter for backward compatibility (maps to image templates)
    get promptTemplates() {
        return this.promptTemplatesByType.image.data;
    },

    // Configuration recipes for different GPU sizes
    omniRecipes: {
        'small-gpu-turbo': {
            name: 'Z-Image Turbo (16-24GB)',
            model: 'Tongyi-MAI/Z-Image-Turbo',
            model_type: 'image',
            steps: 6,
            guidance: 1.0,
            gpu_memory: 0.85,
            cpu_offload: false,
            torch_compile: false
        },
        'small-gpu-quality': {
            name: 'Quality Mode (16-24GB)',
            model: 'Tongyi-MAI/Z-Image-Turbo',
            model_type: 'image',
            steps: 20,
            guidance: 3.5,
            gpu_memory: 0.9,
            cpu_offload: false,
            torch_compile: false
        },
        'medium-gpu-balanced': {
            name: 'Balanced (32-48GB)',
            model: 'Tongyi-MAI/Z-Image-Turbo',
            model_type: 'image',
            steps: 12,
            guidance: 2.5,
            gpu_memory: 0.8,
            cpu_offload: false,
            torch_compile: false
        },
        'medium-gpu-hq': {
            name: 'High Quality (32-48GB)',
            model: 'Qwen/Qwen-Image',
            model_type: 'image',
            steps: 30,
            guidance: 4.0,
            gpu_memory: 0.85,
            cpu_offload: false,
            torch_compile: false
        },
        'large-gpu-fast': {
            name: 'Ultra Fast (80GB+)',
            model: 'Tongyi-MAI/Z-Image-Turbo',
            model_type: 'image',
            steps: 4,
            guidance: 0.5,
            gpu_memory: 0.7,
            cpu_offload: false,
            torch_compile: false
        },
        'large-gpu-production': {
            name: 'Production (80GB+)',
            model: 'Qwen/Qwen-Image',
            model_type: 'image',
            steps: 25,
            guidance: 4.0,
            gpu_memory: 0.85,
            cpu_offload: false,
            torch_compile: true
        },
        'cpu-offload': {
            name: 'CPU Offload Mode',
            model: 'Tongyi-MAI/Z-Image-Turbo',
            model_type: 'image',
            steps: 8,
            guidance: 1.5,
            gpu_memory: 0.7,
            cpu_offload: true,
            torch_compile: false
        },
        // Video Generation Recipes (Wan2.2 models)
        // Memory usage depends on: model size + resolution + duration + fps
        'video-small-fast': {
            name: 'Video 5B Minimal (16GB)',
            model: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers',
            model_type: 'video',
            steps: 20,
            guidance: 4.0,
            gpu_memory: 0.9,
            cpu_offload: false,
            torch_compile: false,
            duration: 2,
            fps: 16,
            resolution: '320x512'  // Minimal resolution for 16GB GPUs
        },
        'video-l4-optimized': {
            name: 'Video 5B for L4 (24GB)',
            model: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers',
            model_type: 'video',
            steps: 25,
            guidance: 4.0,
            gpu_memory: 0.7,  // Lower to leave headroom for generation
            cpu_offload: false,
            torch_compile: false,  // CRITICAL: disable torch.compile
            duration: 2,  // Shorter duration for L4
            fps: 16,
            resolution: '320x512'  // Start with minimal resolution on L4
        },
        'video-medium-balanced': {
            name: 'Video 5B Quality (32GB+)',
            model: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers',
            model_type: 'video',
            steps: 30,
            guidance: 4.0,
            gpu_memory: 0.85,
            cpu_offload: false,
            torch_compile: false,
            duration: 4,
            fps: 16,
            resolution: '480x848'  // 16:9 aspect for 32GB+ GPUs
        },
        'video-large-quality': {
            name: 'Video 14B HQ (48GB+)',
            model: 'Wan-AI/Wan2.2-T2V-A14B-Diffusers',
            model_type: 'video',
            steps: 40,
            guidance: 4.0,
            gpu_memory: 0.85,
            cpu_offload: false,
            torch_compile: false,
            duration: 4,
            fps: 24,
            resolution: '720x1280'  // HD only for 48GB+ GPUs (A40, A100)
        },
        'video-cpu-offload': {
            name: 'Video 5B CPU Offload (16GB+)',
            model: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers',
            model_type: 'video',
            steps: 20,
            guidance: 4.0,
            gpu_memory: 0.5,  // Very low GPU memory - offload more to CPU
            cpu_offload: true,
            torch_compile: false,  // CRITICAL: disable torch.compile to reduce memory
            duration: 2,
            fps: 16,
            resolution: '320x512'  // Minimal resolution with CPU offload
        },
        // TTS (Text-to-Speech) Recipes - Qwen3 TTS
        // Note: Uses /v1/audio/speech endpoint for speech synthesis
        // Apache-2.0 licensed, no HF token required
        // Note: Container mode may not work due to missing onnxruntime in vLLM-Omni image
        // Use subprocess mode with local vLLM-Omni install that includes onnxruntime
        'tts-base': {
            name: 'Qwen3 TTS Base (12GB)',
            model: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
            model_type: 'tts',
            gpu_memory: 0.9,
            cpu_offload: false,
            torch_compile: false,
            speed: 1.0,
            container_limitation: 'onnxruntime'  // Flag for container mode warning
        },
        'tts-voice-design': {
            name: 'Qwen3 TTS Voice Design (24GB+)',
            model: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
            model_type: 'tts',
            gpu_memory: 0.9,
            cpu_offload: false,
            torch_compile: false,
            speed: 1.0,
            container_limitation: 'onnxruntime'
        },
        'tts-custom-voice': {
            name: 'Qwen3 TTS Custom Voice (24GB+)',
            model: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
            model_type: 'tts',
            gpu_memory: 0.9,
            cpu_offload: false,
            torch_compile: false,
            speed: 1.0,
            container_limitation: 'onnxruntime'
        },
        // Audio Generation Recipes (Music/SFX) - Stable Audio
        // Note: Stable Audio requires HF token (gated model) - uses /v1/chat/completions (diffusion)
        'audio-generation': {
            name: 'Stable Audio (32GB+)',
            model: 'stabilityai/stable-audio-open-1.0',
            model_type: 'audio',
            gpu_memory: 0.9,
            cpu_offload: false,
            torch_compile: false,
            requires_hf_token: true
        },
        'audio-generation-offload': {
            name: 'Stable Audio CPU Offload',
            model: 'stabilityai/stable-audio-open-1.0',
            model_type: 'audio',
            gpu_memory: 0.7,
            cpu_offload: true,
            torch_compile: false,
            requires_hf_token: true
        }
    },

    // =========================================================================
    // Template Loading (Option B - Separate HTML)
    // =========================================================================

    async loadTemplate() {
        const container = document.getElementById('vllm-omni-view');
        if (!container) {
            console.error('vLLM-Omni view container not found');
            return;
        }

        // Skip if already loaded
        if (this.templateLoaded && container.querySelector('#omni-config-panel')) {
            console.log('vLLM-Omni template already loaded');
            return;
        }

        console.log('Loading vLLM-Omni template...');

        try {
            const response = await fetch('/static/templates/vllm-omni.html');
            if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);

            const html = await response.text();
            container.innerHTML = html;
            this.templateLoaded = true;

            // Initialize event listeners and UI
            this.init();

            console.log('vLLM-Omni template loaded successfully');
        } catch (error) {
            console.error('Failed to load vLLM-Omni template:', error);
            container.innerHTML = `
                <div class="error-message">
                    <h3>Failed to load vLLM-Omni</h3>
                    <p>${error.message}</p>
                    <button class="btn btn-primary" onclick="window.OmniModule.loadTemplate()">Retry</button>
                </div>
            `;
        }
    },

    async onViewActivated() {
        // Load template if not already loaded (fallback if preload didn't complete)
        if (!this.templateLoaded) {
            await this.loadTemplate();
        }

        // Template is now loaded, refresh status
        if (this.templateLoaded) {
            this.checkServerStatus();
            this.connectLogWebSocket();
        }
    },

    // =========================================================================
    // Initialization (called after template loads)
    // =========================================================================

    init() {
        try {
            console.log('Omni init: setting up event listeners...');
            this.setupEventListeners();
            console.log('Omni init: updating availability status...');
            this.updateAvailabilityStatus();
            console.log('Omni init: updating ModelScope availability...');
            this.updateModelscopeAvailability();
            console.log('Omni init: loading model list...');
            this.loadModelList();
            console.log('Omni init: initializing prompt templates...');
            this.updatePromptTemplates(this.currentModelType || 'image');
            console.log('Omni init: checking server status...');
            this.checkServerStatus();
            console.log('Omni init: starting status polling...');
            this.startStatusPolling();
            console.log('Omni init: updating command preview...');
            this.updateCommandPreview();
            console.log('Omni init: connecting to log WebSocket...');
            this.connectLogWebSocket();
            console.log('Omni init: complete');
        } catch (error) {
            console.error('Omni init error:', error);
        }
    },

    // Start continuous status polling (same pattern as main vLLM Server)
    startStatusPolling() {
        // Stop any existing polling
        this.stopStatusPolling();

        // Poll every 2 seconds (slightly slower than main vLLM Server's 1 second)
        this.statusPollInterval = setInterval(() => {
            this.pollStatus();
        }, 2000);
    },

    stopStatusPolling() {
        if (this.statusPollInterval) {
            clearInterval(this.statusPollInterval);
            this.statusPollInterval = null;
        }
    },

    // Poll server status (same pattern as main vLLM Server's pollStatus)
    async pollStatus() {
        try {
            const response = await fetch('/api/omni/status');
            if (response.ok) {
                const data = await response.json();

                const wasRunning = this.serverRunning;
                const wasReady = this.serverReady;

                this.serverRunning = data.running;
                this.serverReady = data.ready;

                // Update UI if state changed
                if (wasRunning !== data.running || wasReady !== data.ready) {
                    this.updateServerStatus(data.running, data.ready);

                    // If server just stopped, reset health check
                    if (wasRunning && !data.running) {
                        this.stopHealthCheckPolling();
                    }

                    // If server is running but not ready, start health polling
                    if (data.running && !data.ready && !this.healthCheckInterval) {
                        this.startHealthCheckPolling();
                    }
                }
            }
        } catch (error) {
            // Silent fail for polling - don't spam console
        }
    },

    connectLogWebSocket() {
        // Connect to vLLM-Omni log streaming WebSocket
        // Check for both OPEN and CONNECTING states to avoid duplicate connections
        if (this.logWebSocket &&
            (this.logWebSocket.readyState === WebSocket.OPEN ||
             this.logWebSocket.readyState === WebSocket.CONNECTING)) {
            return; // Already connected or connecting
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/omni/logs`;

        try {
            this.logWebSocket = new WebSocket(wsUrl);

            this.logWebSocket.onopen = () => {
                console.log('Omni log WebSocket connected');
            };

            this.logWebSocket.onmessage = (event) => {
                const message = event.data;
                if (message && message.trim()) {
                    this.addLog(message);
                }
            };

            this.logWebSocket.onerror = (error) => {
                console.error('Omni log WebSocket error:', error);
            };

            this.logWebSocket.onclose = () => {
                console.log('Omni log WebSocket closed');
                // Attempt to reconnect after 1 second if server is still running (faster reconnect)
                if (this.serverRunning) {
                    setTimeout(() => this.connectLogWebSocket(), 1000);
                }
            };
        } catch (error) {
            console.error('Failed to connect omni log WebSocket:', error);
        }
    },

    disconnectLogWebSocket() {
        if (this.logWebSocket) {
            this.logWebSocket.close();
            this.logWebSocket = null;
        }
    },

    setupEventListeners() {
        // Server controls
        document.getElementById('omni-start-btn')?.addEventListener('click', () => this.startServer());
        document.getElementById('omni-stop-btn')?.addEventListener('click', () => this.stopServer());

        // Generate button - dispatch based on model type
        document.getElementById('omni-generate-btn')?.addEventListener('click', () => {
            if (this.currentModelType === 'video') {
                this.generateVideo();
            } else if (this.currentModelType === 'tts') {
                this.generateTTS();
            } else if (this.currentModelType === 'audio') {
                this.generateAudio();
            } else {
                this.generateImage();
            }
        });

        // Model type change
        document.getElementById('omni-model-type')?.addEventListener('change', (e) => {
            this.onModelTypeChange(e.target.value);
        });

        // Prompt template selection
        document.getElementById('omni-prompt-template')?.addEventListener('change', (e) => {
            this.applyPromptTemplate(e.target.value);
        });

        // Model selection change - update model ID display
        document.getElementById('omni-model-select')?.addEventListener('change', (e) => {
            console.log('[Omni] Model select change event fired, value:', e.target.value);
            this.updateModelIdDisplay(e.target.value);
        });

        // Custom model input - also check container mode availability
        document.getElementById('omni-custom-model')?.addEventListener('input', (e) => {
            const customModel = e.target.value.trim();
            if (customModel) {
                this.updateContainerModeForModel(customModel);
            } else {
                // If custom model cleared, check the dropdown selection
                const modelSelect = document.getElementById('omni-model-select');
                if (modelSelect) {
                    this.updateContainerModeForModel(modelSelect.value);
                }
            }
        });

        // Note: Recipes modal handlers are attached via onclick in HTML for consistency
        // with main vLLM Server pattern (window.vllmUI.openOmniRecipesModal, etc.)

        // Model Source toggle
        document.getElementById('omni-model-source-hub')?.addEventListener('change', () => {
            this.toggleModelSource();
            this.updateCommandPreview();
        });
        document.getElementById('omni-model-source-modelscope')?.addEventListener('change', () => {
            this.toggleModelSource();
            this.updateCommandPreview();
        });

        // Copy command button
        document.getElementById('omni-copy-command-btn')?.addEventListener('click', () => this.copyCommand());

        // Reset command button - restore auto-generated command
        document.getElementById('omni-reset-command-btn')?.addEventListener('click', () => {
            this.commandManuallyEdited = false;
            this.updateCommandPreview();
            this.ui.showNotification('Command reset to auto-generated', 'info');
        });

        // Track manual edits to command preview
        document.getElementById('omni-command-text')?.addEventListener('input', () => {
            this.commandManuallyEdited = true;
        });

        // Update command preview on config changes (server configuration only)
        const configElements = [
            document.getElementById('omni-model-type'),
            document.getElementById('omni-model-select'),
            document.getElementById('omni-custom-model'),
            document.getElementById('omni-port'),
            document.getElementById('omni-venv-path'),
            document.getElementById('omni-gpu-device'),
            document.getElementById('omni-tensor-parallel'),
            document.getElementById('omni-gpu-memory'),
            document.getElementById('omni-cpu-offload'),
            document.getElementById('omni-torch-compile'),
            document.getElementById('omni-height'),
            document.getElementById('omni-width'),
            document.getElementById('omni-steps'),
            document.getElementById('omni-guidance')
        ].filter(el => el);

        configElements.forEach(element => {
            element.addEventListener('input', () => this.updateCommandPreview());
            element.addEventListener('change', () => this.updateCommandPreview());
        });

        // Run mode changes
        document.querySelectorAll('input[name="omni-run-mode"]').forEach(radio => {
            radio.addEventListener('change', () => this.updateCommandPreview());
        });

        // Parameter sliders
        document.getElementById('omni-steps')?.addEventListener('input', (e) => {
            document.getElementById('omni-steps-value').textContent = e.target.value;
        });
        document.getElementById('omni-guidance')?.addEventListener('input', (e) => {
            document.getElementById('omni-guidance-value').textContent = e.target.value;
        });

        // TTS parameter slider (for Qwen3-TTS)
        document.getElementById('omni-tts-speed')?.addEventListener('input', (e) => {
            document.getElementById('omni-tts-speed-value').textContent = e.target.value;
        });

        // Audio parameter sliders (for Stable Audio) - display value only
        document.getElementById('omni-audio-duration')?.addEventListener('input', (e) => {
            document.getElementById('omni-audio-duration-value').textContent = e.target.value;
        });
        document.getElementById('omni-audio-steps')?.addEventListener('input', (e) => {
            document.getElementById('omni-audio-steps-value').textContent = e.target.value;
        });
        document.getElementById('omni-audio-guidance')?.addEventListener('input', (e) => {
            document.getElementById('omni-audio-guidance-value').textContent = e.target.value;
        });

        // Run mode toggle
        document.querySelectorAll('input[name="omni-run-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.onRunModeChange(e.target.value));
        });

        // Image upload dropzone
        this.setupDropzone();

        // Initialize resize functionality
        this.initResize();

        // Chat functionality
        document.getElementById('omni-chat-send-btn')?.addEventListener('click', () => this.sendOmniChatMessage());
        document.getElementById('omni-chat-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendOmniChatMessage();
            }
        });

        // Attach image button for chat
        document.getElementById('omni-attach-image-btn')?.addEventListener('click', () => {
            document.getElementById('omni-chat-image-input')?.click();
        });

        // Chat clear and export buttons
        document.getElementById('omni-clear-chat-btn')?.addEventListener('click', () => this.clearChat());
        document.getElementById('omni-export-chat-btn')?.addEventListener('click', () => this.exportChat());

        // Gallery clear button
        document.getElementById('omni-clear-gallery-btn')?.addEventListener('click', () => this.clearGallery());

        // Logs controls
        document.getElementById('omni-clear-logs-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearLogs();
        });
        document.getElementById('omni-save-logs-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.saveLogs();
        });

        // Logs row toggle (collapsible)
        document.getElementById('omni-logs-row-toggle')?.addEventListener('click', (e) => {
            // Don't toggle if clicking on controls
            if (e.target.closest('.logs-row-controls')) return;
            this.toggleLogsRow();
        });

        // Install section toggle (collapsible)
        document.getElementById('omni-install-toggle')?.addEventListener('click', () => {
            this.toggleInstallSection();
        });

        // Venv path validation (check vLLM-Omni version when path changes)
        document.getElementById('omni-venv-path')?.addEventListener('blur', () => {
            this.checkOmniVenvVersion();
        });
    },

    setupDropzone() {
        const dropzone = document.getElementById('omni-dropzone');
        const fileInput = document.getElementById('omni-image-input');

        if (!dropzone || !fileInput) return;

        // Click to browse
        dropzone.addEventListener('click', () => fileInput.click());

        // File selected
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.handleImageUpload(e.target.files[0]);
            }
        });

        // Drag and drop
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');

            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.handleImageUpload(e.dataTransfer.files[0]);
            }
        });

        // Clear upload
        document.getElementById('omni-clear-upload')?.addEventListener('click', () => {
            this.clearUploadedImage();
        });
    },

    handleImageUpload(file) {
        if (!file.type.startsWith('image/')) {
            this.ui.showNotification('Please upload an image file', 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.uploadedImage = e.target.result;

            // Show preview
            const preview = document.getElementById('omni-uploaded-preview');
            const img = document.getElementById('omni-uploaded-image');
            const dropzone = document.getElementById('omni-dropzone');

            if (img) img.src = this.uploadedImage;
            if (preview) preview.style.display = 'flex';
            if (dropzone) dropzone.style.display = 'none';

            this.ui.showNotification('Image uploaded for image-to-image generation', 'success');
        };
        reader.readAsDataURL(file);
    },

    clearUploadedImage() {
        this.uploadedImage = null;

        const preview = document.getElementById('omni-uploaded-preview');
        const dropzone = document.getElementById('omni-dropzone');
        const fileInput = document.getElementById('omni-image-input');

        if (preview) preview.style.display = 'none';
        // Restore default block display (not 'flex' which was causing left-alignment issue)
        if (dropzone) dropzone.style.display = '';
        if (fileInput) fileInput.value = '';
    },

    // =========================================================================
    // Availability Status (reuse MCP pattern)
    // =========================================================================

    updateAvailabilityStatus() {
        const statusEl = document.getElementById('omni-availability-status');
        const installSection = document.getElementById('omni-install-section');
        const installBadge = document.getElementById('omni-install-badge');
        const contentEl = document.getElementById('omni-content-wrapper');

        console.log('updateAvailabilityStatus: available =', this.available);

        if (this.available) {
            // vLLM-Omni is installed
            if (statusEl) {
                statusEl.querySelector('.status-dot')?.classList.add('online');
                const textEl = statusEl.querySelector('.status-text');
                if (textEl) textEl.textContent = this.version ? `v${this.version}` : 'Available';
            }
            // Update install section badge to show version
            if (installSection) {
                installSection.style.display = 'block';
                installSection.classList.add('collapsed'); // Collapse when installed
            }
            if (installBadge) {
                installBadge.textContent = this.version ? `v${this.version}` : 'Installed';
                installBadge.classList.remove('not-installed');
                installBadge.classList.add('installed');
            }
            if (contentEl) contentEl.style.display = 'flex';
        } else {
            // vLLM-Omni not installed system-wide - show installation section expanded
            // But user may have it in a custom venv, so don't force container mode
            if (statusEl) {
                statusEl.querySelector('.status-dot')?.classList.remove('online');
                const textEl = statusEl.querySelector('.status-text');
                if (textEl) textEl.textContent = 'Not in system (specify venv path or use Container)';
            }
            // Show install section expanded when not installed
            if (installSection) {
                installSection.style.display = 'block';
                installSection.classList.remove('collapsed'); // Expand to show instructions
            }
            if (installBadge) {
                installBadge.textContent = 'Not Installed';
                installBadge.classList.add('not-installed');
                installBadge.classList.remove('installed');
            }
            // Show content - user can still use container mode
            if (contentEl) contentEl.style.display = 'flex';
        }

        // Update run mode availability based on installation status
        this.updateRunModeAvailability();
    },

    // =========================================================================
    // Run Mode Availability (following main vLLM Server pattern)
    // =========================================================================

    updateRunModeAvailability() {
        // Follow the same pattern as main vLLM Server
        const subprocessLabel = document.getElementById('omni-run-mode-subprocess-label');
        const containerLabel = document.getElementById('omni-run-mode-container-label');

        // Add visual indication for unavailable modes (same as main vLLM Server)
        if (!this.available) {
            if (subprocessLabel) {
                subprocessLabel.classList.add('mode-unavailable');
                subprocessLabel.title = 'vLLM-Omni not installed. Specify venv path below.';
            }
        } else if (!this.version) {
            if (subprocessLabel) {
                subprocessLabel.classList.remove('mode-unavailable');
                subprocessLabel.title = 'vLLM-Omni installed but version unknown. Specify venv path for better detection.';
            }
        } else {
            if (subprocessLabel) {
                subprocessLabel.classList.remove('mode-unavailable');
                subprocessLabel.title = `vLLM-Omni v${this.version} installed`;
            }
        }

        if (!this.containerModeAvailable) {
            if (containerLabel) {
                containerLabel.classList.add('mode-unavailable');
                containerLabel.title = 'No container runtime (podman/docker) found';
            }
        } else {
            if (containerLabel) {
                containerLabel.classList.remove('mode-unavailable');
                containerLabel.title = 'Container mode available';
            }
        }

        // Trigger onRunModeChange to update help text and venv visibility
        const currentMode = document.querySelector('input[name="omni-run-mode"]:checked')?.value || 'subprocess';
        this.onRunModeChange(currentMode);
    },

    // =========================================================================
    // ModelScope Availability (passed from main vLLM Server)
    // =========================================================================

    updateModelscopeAvailability() {
        // Use ModelScope availability from main app (already detected on startup)
        // Follow same pattern as main vLLM Server - visual indication only, don't disable
        const modelscopeLabel = document.getElementById('omni-model-source-modelscope-label');
        const modelscopeRadio = document.getElementById('omni-model-source-modelscope');

        if (!this.modelscopeInstalled) {
            // ModelScope not installed - add visual indication (same as main vLLM Server)
            if (modelscopeLabel) {
                modelscopeLabel.classList.add('mode-unavailable');
                modelscopeLabel.title = 'ModelScope SDK not installed. Run: pip install modelscope>=1.18.1';
            }
            // If ModelScope was selected, switch to HuggingFace (same as main vLLM Server)
            if (modelscopeRadio?.checked) {
                const hubRadio = document.getElementById('omni-model-source-hub');
                if (hubRadio) hubRadio.checked = true;
                this.toggleModelSource();
            }
        } else {
            // ModelScope installed - remove visual indication
            if (modelscopeLabel) {
                modelscopeLabel.classList.remove('mode-unavailable');
                const versionText = this.modelscopeVersion ? `v${this.modelscopeVersion}` : '';
                modelscopeLabel.title = `ModelScope SDK ${versionText} installed`;
            }
        }
    },

    // =========================================================================
    // Venv Version Check (following main vLLM Server pattern)
    // =========================================================================

    async checkOmniVenvVersion() {
        const venvPath = document.getElementById('omni-venv-path')?.value?.trim();

        if (!venvPath) {
            // Reset to system check - don't change availability
            return;
        }

        try {
            const response = await fetch('/api/omni/check-venv', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ venv_path: venvPath })
            });

            const result = await response.json();

            if (result.vllm_omni_installed) {
                this.available = true;
                this.version = result.vllm_omni_version;
                this.ui?.showNotification(`vLLM-Omni v${this.version} found in custom venv`, 'success');
            } else {
                // Venv doesn't have vLLM-Omni - show warning
                this.ui?.showNotification('vLLM-Omni not found in specified venv path', 'warning');
            }

            // Update UI with new availability info
            this.updateAvailabilityStatus();

        } catch (error) {
            console.error('Error checking venv vLLM-Omni version:', error);
            // Don't change status on error - keep previous state
        }
    },

    toggleInstallSection() {
        const installSection = document.getElementById('omni-install-section');
        if (installSection) {
            installSection.classList.toggle('collapsed');
        }
    },

    // =========================================================================
    // Model Type Switching (Hybrid UI)
    // =========================================================================

    onModelTypeChange(modelType) {
        this.currentModelType = modelType;

        const studioPanel = document.getElementById('omni-studio-panel');
        const chatPanel = document.getElementById('omni-chat-panel');
        const generationParams = document.getElementById('omni-generation-params');
        const imageSizeGroup = document.getElementById('omni-image-size-group');
        const videoParamsGroup = document.getElementById('omni-video-params-group');
        const stepsGroup = document.getElementById('omni-steps-group');
        const guidanceGroup = document.getElementById('omni-guidance-group');
        const imageUpload = document.getElementById('omni-image-upload');
        const tipEl = document.getElementById('omni-model-type-tip');
        const ttsParamsGroup = document.getElementById('omni-tts-params-group');
        const audioParamsGroup = document.getElementById('omni-audio-params-group');

        // Update tip text based on model type
        const tipTexts = {
            'image': 'Generate images from text prompts (Text-to-Image)',
            'video': 'Generate videos from text prompts (Text-to-Video)',
            'tts': 'Convert text to natural speech (Qwen3-TTS)',
            'audio': 'Generate music and sound effects (Stable Audio)',
            'omni': 'Multimodal chat with text AND audio input/output'
        };
        if (tipEl) {
            tipEl.textContent = tipTexts[modelType] || tipTexts['image'];
        }

        // Update studio UI elements for image/video/tts/audio
        this.updateStudioUI(modelType);

        if (modelType === 'omni') {
            // Show chat interface for Omni models
            if (studioPanel) studioPanel.style.display = 'none';
            if (chatPanel) chatPanel.style.display = 'flex';
            if (generationParams) generationParams.style.display = 'none';
        } else {
            // Show generation studio for image/video/tts/audio models
            if (studioPanel) studioPanel.style.display = 'flex';
            if (chatPanel) chatPanel.style.display = 'none';

            // Show/hide generation parameters based on model type:
            // - Image: Show image size, steps, guidance
            // - Video: Show video params (resolution, duration, fps), steps, guidance
            // - TTS: Show TTS params (voice, instructions, speed)
            // - Audio: Show audio params (duration, steps, guidance) for Stable Audio

            if (modelType === 'tts') {
                // TTS: Show voice, instructions, speed
                if (generationParams) generationParams.style.display = 'block';
                if (imageSizeGroup) imageSizeGroup.style.display = 'none';
                if (videoParamsGroup) videoParamsGroup.style.display = 'none';
                if (ttsParamsGroup) ttsParamsGroup.style.display = 'block';
                if (audioParamsGroup) audioParamsGroup.style.display = 'none';
                if (stepsGroup) stepsGroup.style.display = 'none';
                if (guidanceGroup) guidanceGroup.style.display = 'none';
            } else if (modelType === 'audio') {
                // Audio (Stable Audio): Show duration, steps, guidance
                if (generationParams) generationParams.style.display = 'block';
                if (imageSizeGroup) imageSizeGroup.style.display = 'none';
                if (videoParamsGroup) videoParamsGroup.style.display = 'none';
                if (ttsParamsGroup) ttsParamsGroup.style.display = 'none';
                if (audioParamsGroup) audioParamsGroup.style.display = 'block';
                if (stepsGroup) stepsGroup.style.display = 'none';
                if (guidanceGroup) guidanceGroup.style.display = 'none';
            } else {
                if (generationParams) generationParams.style.display = 'block';
                // Image Size only for image generation
                if (imageSizeGroup) imageSizeGroup.style.display = modelType === 'image' ? 'block' : 'none';
                // Video params (resolution, duration, fps) only for video generation
                if (videoParamsGroup) videoParamsGroup.style.display = modelType === 'video' ? 'block' : 'none';
                // Hide TTS/audio params for non-audio models
                if (ttsParamsGroup) ttsParamsGroup.style.display = 'none';
                if (audioParamsGroup) audioParamsGroup.style.display = 'none';
                // Inference Steps and Guidance Scale for both image and video
                if (stepsGroup) stepsGroup.style.display = 'block';
                if (guidanceGroup) guidanceGroup.style.display = 'block';
            }

            // Image upload is only available for image models that support image editing
            // Hide for video/audio/tts model types; visibility for image models is handled by updateImageUploadVisibility
            if (imageUpload && modelType !== 'image') {
                imageUpload.style.display = 'none';
                this.clearUploadedImage();
            }
        }

        // Update model dropdown options
        this.updateModelOptions(modelType);

        // Update prompt templates for the selected model type
        this.updatePromptTemplates(modelType);

        // Clear prompt and negative prompt when switching model types
        // (templates are type-specific, so old prompts may not be relevant)
        const promptTextarea = document.getElementById('omni-prompt');
        const negativePromptTextarea = document.getElementById('omni-negative-prompt');
        if (promptTextarea) {
            promptTextarea.value = '';
        }
        if (negativePromptTextarea) {
            negativePromptTextarea.value = '';
        }
    },

    /**
     * Populate the Quick Template dropdown based on model type
     */
    updatePromptTemplates(modelType) {
        const selectEl = document.getElementById('omni-prompt-template');
        if (!selectEl) return;

        // Clear existing options
        selectEl.innerHTML = '';

        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Select a template --';
        selectEl.appendChild(defaultOption);

        // Get templates for this model type
        const templateConfig = this.promptTemplatesByType[modelType];
        if (!templateConfig || !templateConfig.groups) {
            // Hide template selector for omni type or if no templates
            const wrapper = selectEl.closest('.template-select-wrapper');
            if (wrapper) {
                wrapper.style.display = modelType === 'omni' ? 'none' : 'block';
            }
            return;
        }

        // Show template selector
        const wrapper = selectEl.closest('.template-select-wrapper');
        if (wrapper) {
            wrapper.style.display = 'block';
        }

        // Add option groups
        templateConfig.groups.forEach(group => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;

            group.templates.forEach(template => {
                const option = document.createElement('option');
                option.value = template.id;
                option.textContent = template.name;
                optgroup.appendChild(option);
            });

            selectEl.appendChild(optgroup);
        });
    },

    applyPromptTemplate(templateId) {
        if (!templateId) return;

        // Get templates for current model type
        const modelType = this.currentModelType || 'image';
        const templateConfig = this.promptTemplatesByType[modelType];
        if (!templateConfig || !templateConfig.data || !templateConfig.data[templateId]) {
            return;
        }

        const template = templateConfig.data[templateId];
        const promptEl = document.getElementById('omni-prompt');
        const negativeEl = document.getElementById('omni-negative-prompt');

        if (promptEl && template.prompt) {
            promptEl.value = template.prompt;
        }
        if (negativeEl && template.negative) {
            negativeEl.value = template.negative;
        }

        // Reset the dropdown to placeholder after applying
        const selectEl = document.getElementById('omni-prompt-template');
        if (selectEl) {
            setTimeout(() => {
                selectEl.value = '';
            }, 100);
        }

        this.ui.showNotification('Template applied! Customize as needed.', 'info');
    },

    // =========================================================================
    // Recipes Modal
    // =========================================================================

    openRecipesModal() {
        const modal = document.getElementById('omni-recipes-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    },

    closeRecipesModal() {
        const modal = document.getElementById('omni-recipes-modal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    },

    applyRecipe(recipeId) {
        try {
            console.log('[Omni] applyRecipe called with:', recipeId);
            console.log('[Omni] this:', this);
            console.log('[Omni] this.omniRecipes:', this.omniRecipes);

            const recipe = this.omniRecipes[recipeId];
            console.log('[Omni] Found recipe:', recipe);

            if (!recipe) {
                console.error('[Omni] Recipe not found for ID:', recipeId);
                if (this.ui) {
                    this.ui.showNotification('Recipe not found', 'error');
                } else {
                    alert('Recipe not found: ' + recipeId);
                }
                return;
            }

            // Guard: Block disabled model types (video, omni) - Coming Soon
            if (recipe.model_type === 'video' || recipe.model_type === 'omni') {
                console.log('[Omni] Blocked recipe with disabled model type:', recipe.model_type);
                if (this.ui) {
                    this.ui.showNotification('This feature is coming soon!', 'info');
                }
                return;
            }

        // Apply model type FIRST (this rebuilds the model dropdown)
        const modelTypeSelect = document.getElementById('omni-model-type');
        if (modelTypeSelect && recipe.model_type) {
            modelTypeSelect.value = recipe.model_type;
            modelTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            this.onModelTypeChange(recipe.model_type);
        }

        // Apply model AFTER model type change (so it doesn't get overwritten)
        const modelSelect = document.getElementById('omni-model-select');
        console.log('[Omni] modelSelect element:', modelSelect);
        if (modelSelect) {
            // Check if model exists in options
            const option = Array.from(modelSelect.options).find(opt => opt.value === recipe.model);
            if (option) {
                modelSelect.value = recipe.model;
            } else {
                // Add the model if not in list
                const newOption = document.createElement('option');
                newOption.value = recipe.model;
                newOption.textContent = recipe.model.split('/').pop();
                modelSelect.appendChild(newOption);
                modelSelect.value = recipe.model;
            }
            console.log('[Omni] Model set to:', modelSelect.value);
            modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
            this.updateModelIdDisplay(recipe.model);

            // Clear custom model input when recipe is applied (so dropdown selection takes effect)
            const customModelInput = document.getElementById('omni-custom-model');
            if (customModelInput) {
                customModelInput.value = '';
            }
        }

        // Apply inference steps
        const stepsInput = document.getElementById('omni-steps');
        const stepsValue = document.getElementById('omni-steps-value');
        console.log('[Omni] stepsInput element:', stepsInput, 'setting to:', recipe.steps);
        if (stepsInput && recipe.steps !== undefined) {
            stepsInput.value = recipe.steps;
            if (stepsValue) stepsValue.textContent = recipe.steps;
            stepsInput.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[Omni] Steps set to:', stepsInput.value);
        }

        // Apply guidance scale
        const guidanceInput = document.getElementById('omni-guidance');
        const guidanceValue = document.getElementById('omni-guidance-value');
        console.log('[Omni] guidanceInput element:', guidanceInput, 'setting to:', recipe.guidance);
        if (guidanceInput && recipe.guidance !== undefined) {
            guidanceInput.value = recipe.guidance;
            if (guidanceValue) guidanceValue.textContent = recipe.guidance.toFixed(1);
            guidanceInput.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[Omni] Guidance set to:', guidanceInput.value);
        }

        // Apply GPU memory utilization
        const gpuMemoryInput = document.getElementById('omni-gpu-memory');
        if (gpuMemoryInput && recipe.gpu_memory !== undefined) {
            gpuMemoryInput.value = recipe.gpu_memory;
            gpuMemoryInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[Omni] GPU memory set to:', gpuMemoryInput.value);
        }

        // Apply CPU offload
        const cpuOffloadCheckbox = document.getElementById('omni-cpu-offload');
        if (cpuOffloadCheckbox && recipe.cpu_offload !== undefined) {
            cpuOffloadCheckbox.checked = recipe.cpu_offload;
            cpuOffloadCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[Omni] CPU offload set to:', cpuOffloadCheckbox.checked);
        }

        // Apply torch.compile
        const torchCompileCheckbox = document.getElementById('omni-torch-compile');
        if (torchCompileCheckbox && recipe.torch_compile !== undefined) {
            torchCompileCheckbox.checked = recipe.torch_compile;
            torchCompileCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[Omni] Torch compile set to:', torchCompileCheckbox.checked);
        }

        // Apply video-specific parameters
        if (recipe.duration !== undefined) {
            const durationInput = document.getElementById('omni-video-duration');
            if (durationInput) {
                durationInput.value = recipe.duration;
                console.log('[Omni] Video duration set to:', durationInput.value);
            }
        }
        if (recipe.fps !== undefined) {
            const fpsInput = document.getElementById('omni-video-fps');
            if (fpsInput) {
                fpsInput.value = recipe.fps;
                console.log('[Omni] Video FPS set to:', fpsInput.value);
            }
        }
        if (recipe.resolution !== undefined) {
            const resolutionSelect = document.getElementById('omni-video-resolution');
            if (resolutionSelect) {
                resolutionSelect.value = recipe.resolution;
                console.log('[Omni] Video resolution set to:', resolutionSelect.value);
            }
        }

        // Update command preview
        this.commandManuallyEdited = false;
        this.updateCommandPreview();

        // Close modal and show notification
        this.closeRecipesModal();
        console.log('[Omni] Recipe applied successfully:', recipe.name);
        this.ui.showNotification(`✅ Loaded: ${recipe.name}`, 'success');

        // Warn if recipe requires HF token (same pattern as main vLLM Server)
        // Only Stability AI models require this - Qwen models are open (Apache-2.0)
        if (recipe.requires_hf_token) {
            const hfTokenInput = document.getElementById('omni-hf-token');
            const hasToken = hfTokenInput?.value?.trim();
            const modelUrl = recipe.model ? `https://huggingface.co/${recipe.model}` : 'https://huggingface.co/stabilityai/stable-audio-open-1.0';
            if (!hasToken) {
                // Focus on HF token input (same as main vLLM Server)
                if (hfTokenInput) {
                    hfTokenInput.focus();
                }
                this.ui.showNotification('⚠️ This model requires a HuggingFace token AND accepting the license', 'warning');
                this.addLog('WARNING: This model is gated and requires:', 'warning');
                this.addLog('  1. A HuggingFace token: https://huggingface.co/settings/tokens', 'info');
                this.addLog(`  2. Accept license at: ${modelUrl}`, 'info');
            } else {
                // Token is set, but remind about license
                this.addLog(`NOTE: Make sure you have accepted the model license at: ${modelUrl}`, 'info');
            }
        }

        // Warn if recipe has container mode limitations (e.g., missing dependencies)
        if (recipe.container_limitation) {
            const runMode = document.querySelector('input[name="omni-run-mode"]:checked')?.value;
            if (runMode === 'container') {
                this.ui.showNotification(`⚠️ This model may not work in Container mode (missing ${recipe.container_limitation}). Use Subprocess mode instead.`, 'warning');
                this.addLog(`WARNING: ${recipe.name} may not work in Container mode.`, 'warning');
                this.addLog(`  The vLLM-Omni container image is missing: ${recipe.container_limitation}`, 'info');
                this.addLog('  Solution: Use Subprocess mode with local vLLM-Omni install that includes onnxruntime', 'info');
                this.addLog('  Install: pip install onnxruntime', 'info');
            }
        }

        } catch (error) {
            console.error('[Omni] Error applying recipe:', error);
            alert('Error applying recipe: ' + error.message);
        }
    },

    updateStudioUI(modelType) {
        // UI element references for the right interaction panel
        const studioIcon = document.getElementById('omni-studio-icon');
        const studioTitle = document.getElementById('omni-studio-title');
        const imageUpload = document.getElementById('omni-image-upload');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        const promptTextarea = document.getElementById('omni-prompt');
        const galleryIcon = document.getElementById('omni-gallery-icon');
        const galleryText = document.getElementById('omni-gallery-text');
        const galleryHint = document.getElementById('omni-gallery-hint');
        const negativePrompt = document.getElementById('omni-negative-prompt');

        // Mode-specific configurations
        // Note: Video/Image params visibility is handled in onModelTypeChange (left config panel)
        // Note: Gallery header is static since gallery is shared across all types
        const modeConfig = {
            'image': {
                icon: '🎨',
                title: 'Image Generation',
                buttonText: 'Generate Image',
                placeholder: 'Describe the image you want to generate...',
                galleryIcon: '🎨',
                galleryText: 'Generated images will appear here',
                galleryHint: 'Start the server and enter a prompt to generate',
                showImageUpload: true,
                showNegativePrompt: true
            },
            'video': {
                icon: '🎬',
                title: 'Video Generation',
                buttonText: 'Generate Video',
                placeholder: 'Describe the video you want to generate...',
                galleryIcon: '🎬',
                galleryText: 'Generated videos will appear here',
                galleryHint: 'Start the server and enter a prompt to generate',
                showImageUpload: false,
                showNegativePrompt: true
            },
            'tts': {
                icon: '🎙️',
                title: 'Text-to-Speech',
                buttonText: 'Generate Speech',
                placeholder: 'Enter the text you want to convert to speech...',
                galleryIcon: '🎙️',
                galleryText: 'Generated speech will appear here',
                galleryHint: 'Start the server and enter text to synthesize',
                showImageUpload: false,
                showNegativePrompt: false
            },
            'audio': {
                icon: '🎵',
                title: 'Audio Generation (Music/SFX)',
                buttonText: 'Generate Audio',
                placeholder: 'Describe the music or sound you want to generate...',
                galleryIcon: '🎵',
                galleryText: 'Generated audio will appear here',
                galleryHint: 'Start the server and enter a prompt to generate',
                showImageUpload: false,
                showNegativePrompt: true
            }
        };

        const config = modeConfig[modelType] || modeConfig['image'];

        // Apply configuration
        if (studioIcon) studioIcon.textContent = config.icon;
        if (studioTitle) studioTitle.textContent = config.title;
        if (generateBtnText) generateBtnText.textContent = config.buttonText;
        if (promptTextarea) promptTextarea.placeholder = config.placeholder;
        if (galleryIcon) galleryIcon.textContent = config.galleryIcon;
        if (galleryText) galleryText.textContent = config.galleryText;
        if (galleryHint) galleryHint.textContent = config.galleryHint;

        // Show/hide mode-specific sections in the interaction panel
        if (imageUpload) imageUpload.style.display = config.showImageUpload ? 'block' : 'none';
        if (negativePrompt) negativePrompt.style.display = config.showNegativePrompt ? 'block' : 'none';
    },

    async loadModelList() {
        try {
            // Add cache-busting parameter to ensure fresh data
            const response = await fetch(`/api/omni/models?_=${Date.now()}`);
            if (response.ok) {
                this.modelList = await response.json();
                console.log('[Omni] Loaded model list:', Object.keys(this.modelList));
                this.updateModelOptions(this.currentModelType);
            }
        } catch (error) {
            console.error('Failed to load model list:', error);
        }
    },

    updateModelOptions(modelType) {
        const select = document.getElementById('omni-model-select');
        if (!select || !this.modelList) {
            console.warn('[Omni] updateModelOptions: select element or modelList not available');
            return;
        }

        const models = this.modelList[modelType] || [];
        console.log(`[Omni] updateModelOptions: type=${modelType}, found ${models.length} models`);

        select.innerHTML = models.map(m =>
            `<option value="${m.id}" title="${m.description || ''}">${m.name} (${m.vram})</option>`
        ).join('');

        // Update the model ID display with the first model
        if (models.length > 0) {
            this.updateModelIdDisplay(models[0].id);
        }
    },

    updateModelIdDisplay(modelId) {
        console.log('[Omni] updateModelIdDisplay called with:', modelId);
        const modelIdValue = document.getElementById('omni-model-id-value');
        console.log('[Omni] modelIdValue element:', modelIdValue);
        if (modelIdValue) {
            modelIdValue.textContent = modelId;
            console.log('[Omni] Model ID display updated to:', modelIdValue.textContent);
        } else {
            console.warn('[Omni] omni-model-id-value element not found!');
        }
        // Update image upload visibility based on model's image edit support
        this.updateImageUploadVisibility(modelId);
        // Update container mode availability based on model
        this.updateContainerModeForModel(modelId);
    },

    /**
     * Update container mode availability based on selected model.
     * Stable Audio requires in-process mode due to vLLM-Omni serving bug.
     */
    updateContainerModeForModel(modelId) {
        const isStableAudio = modelId && modelId.toLowerCase().includes('stable-audio');
        const containerRadio = document.getElementById('omni-run-mode-container');
        const containerLabel = document.getElementById('omni-run-mode-container-label');
        const subprocessRadio = document.getElementById('omni-run-mode-subprocess');

        if (isStableAudio) {
            // Disable container mode for Stable Audio
            if (containerRadio) {
                containerRadio.disabled = true;
            }
            if (containerLabel) {
                containerLabel.classList.add('mode-unavailable');
                containerLabel.title = 'Container mode unavailable for Stable Audio (uses in-process mode)';
            }
            // Switch to subprocess if container was selected
            if (containerRadio?.checked && subprocessRadio) {
                subprocessRadio.checked = true;
                this.onRunModeChange('subprocess');
            }
        } else {
            // Re-enable container mode for other models (if container runtime is available)
            if (this.containerModeAvailable) {
                if (containerRadio) {
                    containerRadio.disabled = false;
                }
                if (containerLabel) {
                    containerLabel.classList.remove('mode-unavailable');
                    containerLabel.title = 'Container mode available';
                }
            }
        }

        // Update command preview to reflect the mode change
        this.updateCommandPreview();
    },

    /**
     * Get model info from the cached model list
     * @param {string} modelId - The model ID to look up
     * @returns {Object|null} The model info object or null if not found
     */
    getModelInfo(modelId) {
        if (!this.modelList) return null;

        // Search through all model types (image, video, audio, omni)
        for (const modelType of Object.keys(this.modelList)) {
            const models = this.modelList[modelType] || [];
            const model = models.find(m => m.id === modelId);
            if (model) return model;
        }
        return null;
    },

    /**
     * Update the image upload dropzone visibility based on whether
     * the selected model supports image-to-image editing.
     * Only image-edit models (like Qwen-Image-Edit) support input images.
     * @param {string} modelId - The selected model ID
     */
    updateImageUploadVisibility(modelId) {
        const imageUpload = document.getElementById('omni-image-upload');
        const dropzone = document.getElementById('omni-dropzone');
        const dropzoneText = dropzone?.querySelector('.dropzone-text');
        const modelEditTip = document.getElementById('omni-model-edit-tip');

        if (!imageUpload) return;

        const modelInfo = this.getModelInfo(modelId);
        const supportsImageEdit = modelInfo?.supports_image_edit === true;
        const currentModelType = document.getElementById('omni-model-type')?.value;

        console.log('[Omni] updateImageUploadVisibility:', modelId, 'supports_image_edit:', supportsImageEdit);

        // Show/hide the model edit support tip
        if (modelEditTip) {
            modelEditTip.style.display = (currentModelType === 'image' && supportsImageEdit) ? 'block' : 'none';
        }

        // Only show image upload for image models that support image editing
        if (currentModelType === 'image' && supportsImageEdit) {
            imageUpload.style.display = 'block';
            if (dropzoneText) {
                dropzoneText.textContent = 'Drop image here for image-to-image editing';
            }
        } else {
            imageUpload.style.display = 'none';
            // Clear any uploaded image when switching to non-edit model
            this.clearUploadedImage();
        }
    },

    toggleModelSource() {
        const isHub = document.getElementById('omni-model-source-hub')?.checked;
        const isModelscope = document.getElementById('omni-model-source-modelscope')?.checked;

        // Get label elements
        const hubLabel = document.getElementById('omni-model-source-hub-label');
        const modelscopeLabel = document.getElementById('omni-model-source-modelscope-label');

        // Get HF token section (same pattern as main vLLM Server)
        const hfTokenSection = document.getElementById('omni-hf-token-section');

        // Reset all button active states
        hubLabel?.classList.remove('active');
        modelscopeLabel?.classList.remove('active');

        if (isHub) {
            hubLabel?.classList.add('active');
            // Show HF token section for HuggingFace (same as main vLLM Server)
            if (hfTokenSection) hfTokenSection.style.display = 'block';
        } else if (isModelscope) {
            modelscopeLabel?.classList.add('active');
            // Hide HF token section for ModelScope (same as main vLLM Server)
            if (hfTokenSection) hfTokenSection.style.display = 'none';
        }

        // Store current model source
        this.currentModelSource = isHub ? 'hub' : 'modelscope';
    },

    onRunModeChange(mode) {
        // Follow the same pattern as main vLLM Server's toggleRunMode
        const venvGroup = document.getElementById('omni-venv-path-group');
        const helpText = document.getElementById('omni-run-mode-help');
        const subprocessLabel = document.getElementById('omni-run-mode-subprocess-label');
        const containerLabel = document.getElementById('omni-run-mode-container-label');

        if (mode === 'subprocess') {
            // Toggle active class on mode buttons
            if (subprocessLabel) subprocessLabel.classList.add('active');
            if (containerLabel) containerLabel.classList.remove('active');

            // Show venv path option only in subprocess mode (same as main vLLM Server)
            if (venvGroup) venvGroup.style.display = 'block';

            // Update help text based on availability (same pattern as main vLLM Server)
            if (!this.available) {
                if (helpText) helpText.innerHTML = '<span style="color: var(--error-color);">⚠️ vLLM-Omni not installed. Specify venv path below.</span>';
            } else if (!this.version) {
                if (helpText) helpText.innerHTML = '<span style="color: var(--warning-color);">⚠️ vLLM-Omni installed but version unknown. Specify venv path for better detection.</span>';
            } else {
                if (helpText) helpText.textContent = `Subprocess: Direct execution using vLLM-Omni v${this.version}`;
            }
        } else {
            // Toggle active class on mode buttons
            if (subprocessLabel) subprocessLabel.classList.remove('active');
            if (containerLabel) containerLabel.classList.add('active');

            // Hide venv path option in container mode (same as main vLLM Server)
            if (venvGroup) venvGroup.style.display = 'none';

            // Update help text
            if (!this.containerModeAvailable) {
                if (helpText) helpText.innerHTML = '<span style="color: var(--error-color);">⚠️ No container runtime (podman/docker) found</span>';
            } else {
                if (helpText) helpText.textContent = 'Container: Isolated environment using official vLLM-Omni image';
            }
        }

        // Update command preview
        this.updateCommandPreview();
    },

    // =========================================================================
    // Server Management
    // =========================================================================

    async checkServerStatus() {
        try {
            const response = await fetch('/api/omni/status');
            if (response.ok) {
                const status = await response.json();
                this.serverRunning = status.running;
                this.serverReady = status.ready;
                this.updateServerStatus(status.running, status.ready);

                // Start health polling if running but not ready
                if (status.running && !status.ready && !this.healthCheckInterval) {
                    this.startHealthCheckPolling();
                }
            }
        } catch (error) {
            console.error('Failed to check omni server status:', error);
        }
    },

    startHealthCheckPolling() {
        // Poll health endpoint every 3 seconds until ready
        if (this.healthCheckInterval) return;

        this.addLog('Waiting for model to load...');

        this.healthCheckInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/omni/health');
                if (response.ok) {
                    const health = await response.json();
                    if (health.ready) {
                        this.serverReady = true;
                        this.updateServerStatus(true, true);
                        this.stopHealthCheckPolling();
                        this.ui.showNotification('vLLM-Omni server is ready!', 'success');
                        this.addLog('Server is ready to accept requests');
                    }
                }
            } catch (error) {
                // Server not ready yet, continue polling
            }
        }, 3000);
    },

    stopHealthCheckPolling() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    },

    async startServer() {
        const config = this.buildConfig();

        // Check run mode requirements (like main vLLM Server)
        if (config.run_mode === 'subprocess' && !this.available) {
            this.ui.showNotification('Cannot use Subprocess mode: vLLM-Omni is not installed. Use Container mode or install vLLM-Omni.', 'error');
            this.addLog('ERROR: Subprocess mode requires vLLM-Omni to be installed.', 'error');
            return;
        }

        // Check ModelScope SDK requirement (passed from main app)
        if (config.use_modelscope && !this.modelscopeInstalled) {
            this.ui.showNotification('Cannot use ModelScope: modelscope SDK is not installed. Run: pip install modelscope>=1.18.1', 'error');
            this.addLog('ERROR: ModelScope requires the modelscope SDK. Run: pip install modelscope>=1.18.1', 'error');
            return;
        }

        // Check container mode availability (passed from main app)
        if (config.run_mode === 'container' && !this.containerModeAvailable) {
            this.ui.showNotification('Cannot use Container mode: No container runtime (podman/docker) found.', 'error');
            this.addLog('ERROR: Container mode requires podman or docker to be installed.', 'error');
            return;
        }

        // Check if gated model requires HF token (same pattern as main vLLM Server)
        // Note: Only Stability AI models require HF token + license agreement
        // Qwen models (including TTS) are Apache-2.0 licensed and don't require HF token
        if (!config.use_modelscope) {
            const model = config.model.toLowerCase();
            // Known gated models in vLLM-Omni ecosystem (Stability AI models)
            const isGated = model.includes('stabilityai/');

            if (isGated && !config.hf_token) {
                this.ui.showNotification(`⚠️ ${config.model} is a gated model and requires a HuggingFace token!`, 'error');
                this.addLog(`❌ Gated model requires HF token: ${config.model}`, 'error');
                this.addLog('Get your token from: https://huggingface.co/settings/tokens', 'info');
                this.addLog('Also accept the license at: https://huggingface.co/' + config.model, 'info');
                // Focus on HF token input
                const hfTokenInput = document.getElementById('omni-hf-token');
                if (hfTokenInput) hfTokenInput.focus();
                return;
            }
        }

        // Disable start button and show "Starting..." (same pattern as main vLLM Server)
        const startBtn = document.getElementById('omni-start-btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Starting...';
        }

        this.ui.showNotification('Starting vLLM-Omni server...', 'info');
        this.addLog('🚀 Starting vLLM-Omni server...');

        try {
            const response = await fetch('/api/omni/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            const result = await response.json();

            if (response.ok) {
                this.serverRunning = true;

                // In-process mode: model is already loaded and ready
                if (result.mode === 'inprocess') {
                    this.serverReady = true;
                    this.updateServerStatus(true, true);
                    this.ui.showNotification('Stable Audio model loaded and ready!', 'success');
                    this.addLog(`✅ Model loaded in-process mode (no API server needed)`);
                } else {
                    this.serverReady = false;  // Not ready yet, still loading
                    this.updateServerStatus(true, false);
                    this.ui.showNotification('vLLM-Omni server started - loading model...', 'info');
                    this.addLog(`✅ Server started in ${result.mode} mode on port ${result.port}`);
                    // Health check polling will be triggered by log messages (watching for "Uvicorn running")
                    // For container mode, also start polling after a delay as logs may be delayed
                    if (result.mode === 'container') {
                        setTimeout(() => {
                            if (this.serverRunning && !this.serverReady && !this.healthCheckInterval) {
                                this.startHealthCheckPolling();
                            }
                        }, 10000);  // Start polling after 10 seconds if not triggered by logs
                    }
                }
            } else {
                // Handle error detail - could be string or object
                let errorMsg = result.detail || result.error || 'Failed to start server';
                if (typeof errorMsg === 'object') {
                    errorMsg = errorMsg.message || errorMsg.msg || JSON.stringify(errorMsg);
                }
                throw new Error(errorMsg);
            }
        } catch (error) {
            const errMsg = error.message || String(error);
            this.addLog(`❌ Failed to start server: ${errMsg}`, 'error');
            this.ui.showNotification(`Failed to start: ${errMsg}`, 'error');
            // Re-enable start button on error (same pattern as main vLLM Server)
            if (startBtn) startBtn.disabled = false;
        } finally {
            // Always reset button text (same pattern as main vLLM Server)
            if (startBtn) startBtn.textContent = 'Start Server';
        }
    },

    async stopServer() {
        // Disable stop button and show "Stopping..." (same pattern as main vLLM Server)
        const stopBtn = document.getElementById('omni-stop-btn');
        if (stopBtn) {
            stopBtn.disabled = true;
            stopBtn.textContent = 'Stopping...';
        }

        this.ui.showNotification('Stopping vLLM-Omni server...', 'info');
        this.addLog('Stopping vLLM-Omni server...');

        // Stop health check polling
        this.stopHealthCheckPolling();

        try {
            const response = await fetch('/api/omni/stop', { method: 'POST' });

            if (response.ok) {
                this.serverRunning = false;
                this.serverReady = false;
                this.updateServerStatus(false, false);
                this.ui.showNotification('vLLM-Omni server stopped', 'success');
                this.addLog('✅ Server stopped');
            } else {
                const result = await response.json();
                throw new Error(result.detail || 'Failed to stop server');
            }
        } catch (error) {
            this.addLog(`❌ Failed to stop server: ${error.message}`, 'error');
            this.ui.showNotification(`Failed to stop: ${error.message}`, 'error');
            // Re-enable stop button on error (same pattern as main vLLM Server)
            if (stopBtn) stopBtn.disabled = false;
        } finally {
            // Always reset button text (same pattern as main vLLM Server)
            if (stopBtn) stopBtn.textContent = 'Stop Server';
        }
    },

    buildConfig() {
        const runMode = document.querySelector('input[name="omni-run-mode"]:checked')?.value || 'subprocess';
        const useModelscope = document.getElementById('omni-model-source-modelscope')?.checked || false;
        const hfToken = document.getElementById('omni-hf-token')?.value?.trim() || null;

        // Custom model takes priority over dropdown selection (same pattern as main vLLM Server)
        const customModel = document.getElementById('omni-custom-model')?.value?.trim();
        const selectedModel = document.getElementById('omni-model-select')?.value || 'Tongyi-MAI/Z-Image-Turbo';
        const model = customModel || selectedModel;

        return {
            model: model,
            model_type: document.getElementById('omni-model-type')?.value || 'image',
            port: parseInt(document.getElementById('omni-port')?.value) || 8091,
            run_mode: runMode,
            venv_path: runMode === 'subprocess' ? document.getElementById('omni-venv-path')?.value : null,
            gpu_device: document.getElementById('omni-gpu-device')?.value || null,
            tensor_parallel_size: parseInt(document.getElementById('omni-tensor-parallel')?.value) || 1,
            gpu_memory_utilization: parseFloat(document.getElementById('omni-gpu-memory')?.value) || 0.9,
            enable_cpu_offload: document.getElementById('omni-cpu-offload')?.checked || false,
            enable_torch_compile: document.getElementById('omni-torch-compile')?.checked || false,
            accelerator: 'nvidia',  // Default to NVIDIA, could add UI selector if needed
            default_height: parseInt(document.getElementById('omni-height')?.value) || 1024,
            default_width: parseInt(document.getElementById('omni-width')?.value) || 1024,
            num_inference_steps: parseInt(document.getElementById('omni-steps')?.value) || 6,
            guidance_scale: parseFloat(document.getElementById('omni-guidance')?.value) || 1.0,
            // Model source - if true, download from ModelScope instead of HuggingFace
            use_modelscope: useModelscope,
            // HuggingFace token for gated models (Stable Audio, etc.)
            hf_token: hfToken,
        };
    },

    // =========================================================================
    // Command Preview
    // =========================================================================

    updateCommandPreview() {
        const commandText = document.getElementById('omni-command-text');
        if (!commandText) return;

        // Skip auto-update if user has manually edited the command
        if (this.commandManuallyEdited) return;

        const config = this.buildConfig();
        const runMode = document.querySelector('input[name="omni-run-mode"]:checked')?.value || 'subprocess';

        let command = '';

        // Check if Stable Audio model (uses in-process mode)
        const isStableAudio = config.model && config.model.toLowerCase().includes('stable-audio');

        if (isStableAudio) {
            // In-process mode for Stable Audio (bypasses vLLM-Omni serving bug)
            command = `# In-Process Mode (Stable Audio)\n`;
            command += `# Uses offline inference to bypass vLLM-Omni serving bug\n\n`;
            command += `# Python equivalent:\n`;
            command += `from vllm_omni.entrypoints.omni import Omni\n\n`;
            command += `model = Omni(\n`;
            command += `    model="${config.model}",\n`;
            command += `    gpu_memory_utilization=${config.gpu_memory_utilization},\n`;
            command += `    enforce_eager=${!config.enable_torch_compile ? 'True' : 'False'},\n`;
            command += `    trust_remote_code=True,\n`;
            command += `)\n\n`;
            command += `# Generate audio (parameters from UI at generation time):\n`;
            command += `output = model.generate(\n`;
            command += `    prompt,\n`;
            command += `    negative_prompt=negative_prompt,\n`;
            command += `    guidance_scale=guidance_scale,\n`;
            command += `    num_inference_steps=num_inference_steps,\n`;
            command += `    extra={"audio_start_in_s": 0.0, "audio_end_in_s": duration},\n`;
            command += `)\n`;
        } else if (runMode === 'container') {
            // Container mode - podman/docker command
            // Note: Actual runtime (podman/docker) is auto-detected at startup
            const runtime = 'podman';  // or 'docker'
            const image = 'vllm/vllm-omni:v0.14.0rc1';

            // GPU device selection
            const gpuFlag = config.gpu_device
                ? `--device nvidia.com/gpu=${config.gpu_device}`
                : '--device nvidia.com/gpu=all';

            // Note: Docker uses --gpus all, Podman uses --device nvidia.com/gpu=all
            command = `# Container mode\n`;
            command += `# For Docker: --gpus all (or --gpus '"device=0"' for specific GPU)\n`;
            command += `# For Podman: --device nvidia.com/gpu=all (or =0 for specific GPU)\n`;
            command += `${runtime} run ${gpuFlag} \\
  --ipc=host \\
  -v ~/.cache/huggingface:/root/.cache/huggingface \\
  -p ${config.port}:${config.port}`;

            if (config.hf_token) {
                command += ` \\\n  -e HF_TOKEN=$HF_TOKEN`;
            }
            if (config.use_modelscope) {
                command += ` \\\n  -e VLLM_USE_MODELSCOPE=True`;
            }

            command += ` \\\n  ${image}`;
            command += ` \\\n  vllm serve ${config.model} --omni`;
            command += ` \\\n  --port ${config.port}`;
            if (config.tensor_parallel_size > 1) {
                command += ` \\\n  --tensor-parallel-size ${config.tensor_parallel_size}`;
            }
            if (config.gpu_memory_utilization && config.gpu_memory_utilization !== 0.9) {
                command += ` \\\n  --gpu-memory-utilization ${config.gpu_memory_utilization}`;
            }
            if (!config.enable_torch_compile) {
                command += ` \\\n  --enforce-eager`;  // Disable torch.compile for faster startup
            }
        } else {
            // Subprocess mode - vllm-omni CLI command
            command = `# Subprocess mode\n`;

            // Environment variables
            if (config.gpu_device) {
                command += `export CUDA_VISIBLE_DEVICES=${config.gpu_device}\n`;
            }
            if (config.use_modelscope) {
                command += `export VLLM_USE_MODELSCOPE=True\n`;
            }

            // Activate venv if specified
            if (config.venv_path) {
                command += `source ${config.venv_path}/bin/activate\n`;
            }

            command += `\nvllm serve ${config.model} --omni`;
            command += ` \\\n  --port ${config.port}`;
            if (config.tensor_parallel_size > 1) {
                command += ` \\\n  --tensor-parallel-size ${config.tensor_parallel_size}`;
            }
            if (config.gpu_memory_utilization && config.gpu_memory_utilization !== 0.9) {
                command += ` \\\n  --gpu-memory-utilization ${config.gpu_memory_utilization}`;
            }
            if (!config.enable_torch_compile) {
                command += ` \\\n  --enforce-eager`;  // Disable torch.compile for faster startup
            }
        }

        commandText.value = command;
    },

    copyCommand() {
        const commandText = document.getElementById('omni-command-text');
        const copyBtn = document.getElementById('omni-copy-command-btn');

        if (!commandText) return;

        navigator.clipboard.writeText(commandText.value).then(() => {
            // Visual feedback
            if (copyBtn) {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.classList.remove('copied');
                }, 2000);
            }
            this.ui.showNotification('Command copied to clipboard', 'success');
        }).catch(err => {
            console.error('Failed to copy:', err);
            // Fallback
            commandText.select();
            document.execCommand('copy');
            this.ui.showNotification('Command copied to clipboard', 'success');
        });
    },

    updateServerStatus(running, ready = false) {
        const statusEl = document.getElementById('omni-server-status');
        const dot = statusEl?.querySelector('.status-dot');
        const text = statusEl?.querySelector('.status-text');
        const startBtn = document.getElementById('omni-start-btn');
        const stopBtn = document.getElementById('omni-stop-btn');
        const generateBtn = document.getElementById('omni-generate-btn');
        const chatSendBtn = document.getElementById('omni-chat-send-btn');

        if (running && ready) {
            // Server is running AND ready to accept requests
            dot?.classList.add('online');
            dot?.classList.remove('starting');
            if (text) text.textContent = 'Ready';
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.classList.add('btn-ready');
            }
            if (chatSendBtn) chatSendBtn.disabled = false;
        } else if (running && !ready) {
            // Server is running but still loading model
            dot?.classList.remove('online');
            dot?.classList.add('starting');
            if (text) text.textContent = 'Starting...';
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            if (generateBtn) {
                generateBtn.disabled = true;
                generateBtn.classList.remove('btn-ready');
            }
            if (chatSendBtn) chatSendBtn.disabled = true;
        } else {
            // Server is not running
            dot?.classList.remove('online');
            dot?.classList.remove('starting');
            if (text) text.textContent = 'Offline';
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            if (generateBtn) {
                generateBtn.disabled = true;
                generateBtn.classList.remove('btn-ready');
            }
            if (chatSendBtn) chatSendBtn.disabled = true;
        }
    },

    // =========================================================================
    // Image Generation
    // =========================================================================

    async generateImage() {
        // Check if server is ready
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the server first', 'warning');
            }
            return;
        }

        const prompt = document.getElementById('omni-prompt')?.value?.trim();
        if (!prompt) {
            this.ui.showNotification('Please enter a prompt', 'warning');
            return;
        }

        const request = {
            prompt,
            negative_prompt: document.getElementById('omni-negative-prompt')?.value || null,
            width: parseInt(document.getElementById('omni-width')?.value) || 1024,
            height: parseInt(document.getElementById('omni-height')?.value) || 1024,
            num_inference_steps: parseInt(document.getElementById('omni-steps')?.value) || 6,
            guidance_scale: parseFloat(document.getElementById('omni-guidance')?.value) || 1.0,
            seed: document.getElementById('omni-seed')?.value ? parseInt(document.getElementById('omni-seed').value) : null,
            // Include uploaded image for image-to-image generation (if any)
            input_image: this.uploadedImage || null,
        };

        const isImg2Img = !!this.uploadedImage;
        const modeText = isImg2Img ? 'image-to-image' : 'text-to-image';
        this.ui.showNotification(`Generating ${modeText}...`, 'info');
        this.addLog(`Generating ${modeText}: "${prompt.substring(0, 50)}..."`);

        const generateBtn = document.getElementById('omni-generate-btn');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        if (generateBtn) generateBtn.disabled = true;
        if (generateBtnText) generateBtnText.textContent = 'Generating...';

        try {
            const response = await fetch('/api/omni/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });

            const result = await response.json();

            if (result.success) {
                this.addImageToGallery(result.image_base64, prompt);
                this.ui.showNotification(`Image generated in ${result.generation_time?.toFixed(1)}s`, 'success');
                this.addLog(`Image generated in ${result.generation_time?.toFixed(1)}s`);
            } else {
                this.ui.showNotification(`Generation failed: ${result.error}`, 'error');
                this.addLog(`ERROR: ${result.error}`);
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
            this.addLog(`ERROR: ${error.message}`);
        } finally {
            if (generateBtn) generateBtn.disabled = false;
            if (generateBtnText) generateBtnText.textContent = 'Generate Image';
        }
    },

    async generateVideo() {
        // Check if server is ready
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the server first', 'warning');
            }
            return;
        }

        const prompt = document.getElementById('omni-prompt')?.value?.trim();
        if (!prompt) {
            this.ui.showNotification('Please enter a prompt', 'warning');
            return;
        }

        // Parse resolution from dropdown (format: "HEIGHTxWIDTH")
        const resolutionSelect = document.getElementById('omni-video-resolution');
        const resolution = resolutionSelect?.value || '480x640';
        const [height, width] = resolution.split('x').map(Number);

        const request = {
            prompt,
            negative_prompt: document.getElementById('omni-negative-prompt')?.value || null,
            duration: parseInt(document.getElementById('omni-video-duration')?.value) || 4,
            fps: parseInt(document.getElementById('omni-video-fps')?.value) || 16,
            height: height || 480,
            width: width || 640,
            num_inference_steps: parseInt(document.getElementById('omni-steps')?.value) || 30,
            guidance_scale: parseFloat(document.getElementById('omni-guidance')?.value) || 4.0,
            seed: document.getElementById('omni-seed')?.value ? parseInt(document.getElementById('omni-seed').value) : null,
        };

        this.ui.showNotification('Generating video... This may take a while.', 'info');
        this.addLog(`Generating video: "${prompt.substring(0, 50)}..." (${request.duration}s @ ${request.fps}fps, ${request.height}x${request.width})`);

        const generateBtn = document.getElementById('omni-generate-btn');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        if (generateBtn) generateBtn.disabled = true;
        if (generateBtnText) generateBtnText.textContent = 'Generating...';

        try {
            const response = await fetch('/api/omni/generate-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });

            const result = await response.json();

            if (result.success) {
                this.addVideoToGallery(result.video_base64, prompt, result.duration);
                this.ui.showNotification(`Video generated in ${result.generation_time?.toFixed(1)}s`, 'success');
                this.addLog(`Video generated in ${result.generation_time?.toFixed(1)}s`);
            } else {
                this.ui.showNotification(`Generation failed: ${result.error}`, 'error');
                this.addLog(`ERROR: ${result.error}`);
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
            this.addLog(`ERROR: ${error.message}`);
        } finally {
            if (generateBtn) generateBtn.disabled = false;
            if (generateBtnText) generateBtnText.textContent = 'Generate Video';
        }
    },

    async generateTTS() {
        // Check if server is ready
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the server first', 'warning');
            }
            return;
        }

        const prompt = document.getElementById('omni-prompt')?.value?.trim();
        if (!prompt) {
            this.ui.showNotification('Please enter text to synthesize', 'warning');
            return;
        }

        // Build request with TTS-specific parameters (Qwen3-TTS)
        const voice = document.getElementById('omni-tts-voice')?.value || 'Vivian';
        const instructions = document.getElementById('omni-tts-instructions')?.value?.trim() || null;
        const speed = parseFloat(document.getElementById('omni-tts-speed')?.value) || 1.0;

        const request = {
            text: prompt,
            voice: voice,
            speed: speed,
            instructions: instructions
        };

        this.ui.showNotification('Generating speech...', 'info');
        this.addLog(`Generating speech: "${prompt.substring(0, 50)}..." (voice: ${voice}, speed: ${speed}x)`);

        const generateBtn = document.getElementById('omni-generate-btn');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        if (generateBtn) generateBtn.disabled = true;
        if (generateBtnText) generateBtnText.textContent = 'Generating...';

        try {
            const response = await fetch('/api/omni/generate-tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });

            const result = await response.json();

            if (result.success) {
                this.addAudioToGallery(result.audio_base64, prompt, result.duration, result.audio_format);
                this.ui.showNotification(`Speech generated in ${result.generation_time?.toFixed(1)}s`, 'success');
                this.addLog(`Speech generated in ${result.generation_time?.toFixed(1)}s`);
            } else {
                this.ui.showNotification(`Generation failed: ${result.error}`, 'error');
                this.addLog(`ERROR: ${result.error}`);
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
            this.addLog(`ERROR: ${error.message}`);
        } finally {
            if (generateBtn) generateBtn.disabled = false;
            if (generateBtnText) generateBtnText.textContent = 'Generate Speech';
        }
    },

    async generateAudio() {
        // Check if server is ready (Stable Audio - music/SFX generation)
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the server first', 'warning');
            }
            return;
        }

        const prompt = document.getElementById('omni-prompt')?.value?.trim();
        if (!prompt) {
            this.ui.showNotification('Please enter a description for the audio', 'warning');
            return;
        }

        // Build request with Stable Audio parameters (diffusion-based)
        const audioDuration = parseFloat(document.getElementById('omni-audio-duration')?.value) || 10.0;
        const audioSteps = parseInt(document.getElementById('omni-audio-steps')?.value) || 50;
        const audioGuidance = parseFloat(document.getElementById('omni-audio-guidance')?.value) || 7.0;
        const negativePrompt = document.getElementById('omni-negative-prompt')?.value?.trim() || 'low quality, average quality';

        const request = {
            text: prompt,
            audio_duration: audioDuration,
            num_inference_steps: audioSteps,
            guidance_scale: audioGuidance,
            negative_prompt: negativePrompt,
            seed: document.getElementById('omni-seed')?.value ? parseInt(document.getElementById('omni-seed').value) : null,
        };

        this.ui.showNotification('Generating audio...', 'info');
        this.addLog(`Generating audio: "${prompt.substring(0, 50)}..." (${audioDuration}s, ${audioSteps} steps, guidance: ${audioGuidance})`);

        const generateBtn = document.getElementById('omni-generate-btn');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        if (generateBtn) generateBtn.disabled = true;
        if (generateBtnText) generateBtnText.textContent = 'Generating...';

        try {
            const response = await fetch('/api/omni/generate-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });

            const result = await response.json();

            if (result.success) {
                this.addAudioToGallery(result.audio_base64, prompt, result.duration, result.audio_format);
                this.ui.showNotification(`Audio generated in ${result.generation_time?.toFixed(1)}s`, 'success');
                this.addLog(`Audio generated in ${result.generation_time?.toFixed(1)}s`);
            } else {
                this.ui.showNotification(`Generation failed: ${result.error}`, 'error');
                this.addLog(`ERROR: ${result.error}`);
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
            this.addLog(`ERROR: ${error.message}`);
        } finally {
            if (generateBtn) generateBtn.disabled = false;
            if (generateBtnText) generateBtnText.textContent = 'Generate Audio';
        }
    },

    addImageToGallery(base64Image, prompt) {
        const gallery = document.getElementById('omni-gallery');
        if (!gallery) return;

        // Remove placeholder
        const placeholder = gallery.querySelector('.gallery-placeholder');
        if (placeholder) placeholder.remove();

        // Create gallery item
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.innerHTML = `
            <img src="data:image/png;base64,${base64Image}" alt="${this.escapeHtml(prompt)}">
            <div class="gallery-item-overlay">
                <span class="gallery-item-prompt">${this.escapeHtml(prompt.substring(0, 50))}...</span>
            </div>
            <div class="gallery-item-actions">
                <button class="btn btn-sm gallery-download-btn" title="Download">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>
                <button class="btn btn-sm gallery-delete-btn" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                </button>
            </div>
        `;

        // Store base64 for download
        item.dataset.base64 = base64Image;
        item.dataset.prompt = prompt;

        // Click on image to open lightbox
        item.querySelector('img')?.addEventListener('click', () => {
            this.openLightbox(base64Image, prompt);
        });

        // Download click handler
        item.querySelector('.gallery-download-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadImage(item);
        });

        // Delete click handler
        item.querySelector('.gallery-delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteGalleryItem(item);
        });

        // Prepend to gallery
        gallery.prepend(item);
        this.updateGalleryCount();
    },

    addVideoToGallery(base64Video, prompt, duration) {
        const gallery = document.getElementById('omni-gallery');
        if (!gallery) return;

        // Remove placeholder
        const placeholder = gallery.querySelector('.gallery-placeholder');
        if (placeholder) placeholder.remove();

        // Create gallery item for video
        const item = document.createElement('div');
        item.className = 'gallery-item gallery-item-video';
        item.innerHTML = `
            <video loop muted playsinline>
                <source src="data:video/mp4;base64,${base64Video}" type="video/mp4">
                Your browser does not support video playback.
            </video>
            <div class="video-expand-hint" title="Click to enlarge">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 3 21 3 21 9"/>
                    <polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/>
                    <line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
            </div>
            <div class="gallery-item-overlay">
                <span class="gallery-item-prompt">${this.escapeHtml(prompt.substring(0, 50))}...</span>
                <span class="gallery-item-duration">${duration}s</span>
            </div>
            <div class="gallery-item-actions">
                <button class="btn btn-sm gallery-expand-btn" title="Fullscreen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 3 21 3 21 9"/>
                        <polyline points="9 21 3 21 3 15"/>
                        <line x1="21" y1="3" x2="14" y2="10"/>
                        <line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                </button>
                <button class="btn btn-sm gallery-download-btn" title="Download">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>
                <button class="btn btn-sm gallery-delete-btn" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                </button>
            </div>
        `;

        // Store data for download
        item.dataset.base64 = base64Video;
        item.dataset.prompt = prompt;
        item.dataset.type = 'video';

        const video = item.querySelector('video');

        // Click on video item to open lightbox (excluding action buttons)
        item.addEventListener('click', (e) => {
            // Don't open lightbox if clicking on action buttons
            if (e.target.closest('.gallery-item-actions')) return;
            this.openVideoLightbox(base64Video, prompt);
        });

        // Expand button click handler
        item.querySelector('.gallery-expand-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openVideoLightbox(base64Video, prompt);
        });

        // Auto-play video on hover (muted)
        item.addEventListener('mouseenter', () => {
            video?.play().catch(() => {});
        });

        item.addEventListener('mouseleave', () => {
            video?.pause();
            if (video) video.currentTime = 0;
        });

        // Download click handler
        item.querySelector('.gallery-download-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadVideo(item);
        });

        // Delete click handler
        item.querySelector('.gallery-delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteGalleryItem(item);
        });

        // Prepend to gallery
        gallery.prepend(item);
        this.updateGalleryCount();
    },

    downloadVideo(item) {
        const base64 = item.dataset.base64;
        const prompt = item.dataset.prompt || 'video';

        const link = document.createElement('a');
        link.href = `data:video/mp4;base64,${base64}`;
        link.download = `omni-video-${prompt.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    addAudioToGallery(base64Audio, text, duration, audioFormat = 'audio/wav') {
        const gallery = document.getElementById('omni-gallery');
        if (!gallery) return;

        // Remove placeholder
        const placeholder = gallery.querySelector('.gallery-placeholder');
        if (placeholder) placeholder.remove();

        // Normalize audio format - ensure it's a valid MIME type
        const mimeType = audioFormat || 'audio/wav';

        // Get file extension for the source type attribute
        const formatMap = {
            'audio/wav': 'audio/wav',
            'audio/wave': 'audio/wav',
            'audio/x-wav': 'audio/wav',
            'audio/flac': 'audio/flac',
            'audio/x-flac': 'audio/flac',
            'audio/mp3': 'audio/mpeg',
            'audio/mpeg': 'audio/mpeg',
            'audio/ogg': 'audio/ogg',
            'audio/webm': 'audio/webm',
        };
        const normalizedMime = formatMap[mimeType] || mimeType;

        // Create gallery item for audio
        const item = document.createElement('div');
        item.className = 'gallery-item gallery-item-audio';
        item.innerHTML = `
            <div class="audio-card">
                <div class="audio-icon">🔊</div>
                <div class="audio-text">${this.escapeHtml(text.substring(0, 80))}${text.length > 80 ? '...' : ''}</div>
                <audio controls>
                    <source src="data:${normalizedMime};base64,${base64Audio}" type="${normalizedMime}">
                    Your browser does not support audio playback.
                </audio>
                ${duration ? `<span class="audio-duration">${duration.toFixed(1)}s</span>` : ''}
            </div>
            <div class="gallery-item-actions">
                <button class="btn btn-sm gallery-download-btn" title="Download">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>
                <button class="btn btn-sm gallery-delete-btn" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                </button>
            </div>
        `;

        // Store data for download
        item.dataset.base64 = base64Audio;
        item.dataset.prompt = text;
        item.dataset.type = 'audio';
        item.dataset.audioFormat = normalizedMime;

        // Download click handler
        item.querySelector('.gallery-download-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadAudio(item);
        });

        // Delete click handler
        item.querySelector('.gallery-delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteGalleryItem(item);
        });

        // Prepend to gallery
        gallery.prepend(item);
        this.updateGalleryCount();
    },

    downloadAudio(item) {
        const base64 = item.dataset.base64;
        const prompt = item.dataset.prompt || 'audio';
        const audioFormat = item.dataset.audioFormat || 'audio/wav';

        // Map MIME type to file extension
        const extensionMap = {
            'audio/wav': 'wav',
            'audio/flac': 'flac',
            'audio/mpeg': 'mp3',
            'audio/mp3': 'mp3',
            'audio/ogg': 'ogg',
            'audio/webm': 'webm',
        };
        const extension = extensionMap[audioFormat] || 'wav';

        const link = document.createElement('a');
        link.href = `data:${audioFormat};base64,${base64}`;
        link.download = `omni-audio-${prompt.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    downloadImage(item) {
        const base64 = item.dataset.base64;
        const prompt = item.dataset.prompt || 'generated';

        const link = document.createElement('a');
        link.href = `data:image/png;base64,${base64}`;
        link.download = `vllm-omni-${Date.now()}.png`;
        link.click();

        this.ui.showNotification('Image downloaded', 'success');
    },

    deleteGalleryItem(item) {
        // Remove with fade animation
        item.style.transition = 'opacity 0.3s, transform 0.3s';
        item.style.opacity = '0';
        item.style.transform = 'scale(0.8)';

        setTimeout(() => {
            item.remove();
            this.updateGalleryCount();

            // Show placeholder if gallery is empty
            const gallery = document.getElementById('omni-gallery');
            if (gallery && gallery.querySelectorAll('.gallery-item').length === 0) {
                gallery.innerHTML = `
                    <div class="gallery-placeholder" id="omni-gallery-placeholder">
                        <span class="placeholder-icon" id="omni-gallery-icon">🖼️</span>
                        <span class="placeholder-text" id="omni-gallery-text">Generated content will appear here</span>
                        <span class="placeholder-hint" id="omni-gallery-hint">Start the server and enter a prompt to generate</span>
                    </div>
                `;
            }

            this.ui.showNotification('Item deleted', 'info');
        }, 300);
    },

    clearGallery() {
        const gallery = document.getElementById('omni-gallery');
        if (!gallery) return;

        const items = gallery.querySelectorAll('.gallery-item');
        if (items.length === 0) {
            this.ui.showNotification('Gallery is already empty', 'info');
            return;
        }

        // Confirm before clearing
        if (!confirm(`Clear all ${items.length} item(s) from the gallery?`)) {
            return;
        }

        // Remove all items
        items.forEach(item => item.remove());

        // Show placeholder
        gallery.innerHTML = `
            <div class="gallery-placeholder" id="omni-gallery-placeholder">
                <span class="placeholder-icon" id="omni-gallery-icon">🖼️</span>
                <span class="placeholder-text" id="omni-gallery-text">Generated content will appear here</span>
                <span class="placeholder-hint" id="omni-gallery-hint">Start the server and enter a prompt to generate</span>
            </div>
        `;

        this.updateGalleryCount();
        this.ui.showNotification('Gallery cleared', 'success');
    },

    updateGalleryCount() {
        const gallery = document.getElementById('omni-gallery');
        const countEl = document.getElementById('omni-gallery-count');
        if (!gallery || !countEl) return;

        const count = gallery.querySelectorAll('.gallery-item').length;
        const itemText = count === 1 ? 'item' : 'items';
        countEl.textContent = `${count} ${itemText}`;
    },

    // =========================================================================
    // Lightbox
    // =========================================================================

    openLightbox(base64Image, prompt) {
        const lightbox = document.getElementById('omni-lightbox');
        const lightboxImage = document.getElementById('omni-lightbox-image');
        const lightboxPrompt = document.getElementById('omni-lightbox-prompt');
        const downloadBtn = document.getElementById('omni-lightbox-download');

        if (!lightbox || !lightboxImage) return;

        // Set image and prompt
        lightboxImage.src = `data:image/png;base64,${base64Image}`;
        if (lightboxPrompt) lightboxPrompt.textContent = prompt;

        // Store base64 for download
        lightbox.dataset.base64 = base64Image;

        // Show lightbox
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Close handlers (only add once)
        if (!lightbox.dataset.listenersAdded) {
            // Close on backdrop click
            lightbox.querySelector('.lightbox-backdrop')?.addEventListener('click', () => {
                this.closeLightbox();
            });

            // Close on X button click
            lightbox.querySelector('.lightbox-close')?.addEventListener('click', () => {
                this.closeLightbox();
            });

            // Close on Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && lightbox.classList.contains('active')) {
                    this.closeLightbox();
                }
            });

            // Download button
            downloadBtn?.addEventListener('click', () => {
                const base64 = lightbox.dataset.base64;
                if (base64) {
                    const link = document.createElement('a');
                    link.href = `data:image/png;base64,${base64}`;
                    link.download = `vllm-omni-${Date.now()}.png`;
                    link.click();
                    this.ui.showNotification('Image downloaded', 'success');
                }
            });

            lightbox.dataset.listenersAdded = 'true';
        }
    },

    closeLightbox() {
        const lightbox = document.getElementById('omni-lightbox');
        if (lightbox) {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
        }
    },

    // =========================================================================
    // Video Lightbox
    // =========================================================================

    openVideoLightbox(base64Video, prompt) {
        const lightbox = document.getElementById('omni-video-lightbox');
        const lightboxVideo = document.getElementById('omni-lightbox-video');
        const lightboxPrompt = document.getElementById('omni-video-lightbox-prompt');
        const downloadBtn = document.getElementById('omni-video-lightbox-download');

        if (!lightbox || !lightboxVideo) return;

        // Set video source and prompt
        const videoSource = lightboxVideo.querySelector('source');
        if (videoSource) {
            videoSource.src = `data:video/mp4;base64,${base64Video}`;
        }
        lightboxVideo.load(); // Reload video with new source
        if (lightboxPrompt) lightboxPrompt.textContent = prompt;

        // Store base64 for download
        lightbox.dataset.base64 = base64Video;

        // Show lightbox
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Auto-play the video
        lightboxVideo.play().catch(() => {});

        // Close handlers (only add once)
        if (!lightbox.dataset.listenersAdded) {
            // Close on backdrop click
            lightbox.querySelector('.lightbox-backdrop')?.addEventListener('click', () => {
                this.closeVideoLightbox();
            });

            // Close on X button click
            lightbox.querySelector('.lightbox-close')?.addEventListener('click', () => {
                this.closeVideoLightbox();
            });

            // Close on Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && lightbox.classList.contains('active')) {
                    this.closeVideoLightbox();
                }
            });

            // Download button
            downloadBtn?.addEventListener('click', () => {
                const base64 = lightbox.dataset.base64;
                if (base64) {
                    const link = document.createElement('a');
                    link.href = `data:video/mp4;base64,${base64}`;
                    link.download = `vllm-omni-video-${Date.now()}.mp4`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    this.ui.showNotification('Video downloaded', 'success');
                }
            });

            lightbox.dataset.listenersAdded = 'true';
        }
    },

    closeVideoLightbox() {
        const lightbox = document.getElementById('omni-video-lightbox');
        const lightboxVideo = document.getElementById('omni-lightbox-video');

        if (lightbox) {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';

            // Pause video when closing
            if (lightboxVideo) {
                lightboxVideo.pause();
            }
        }
    },

    // =========================================================================
    // Chat (for Omni models)
    // =========================================================================

    async sendOmniChatMessage() {
        const input = document.getElementById('omni-chat-input');
        const sendBtn = document.getElementById('omni-chat-send-btn');
        const message = input?.value?.trim();

        if (!message) return;

        // Check if server is ready
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the vLLM-Omni server first', 'warning');
            }
            return;
        }

        // Add user message to UI
        this.addOmniChatMessage('user', message);

        // Clear input and disable send button
        if (input) input.value = '';
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.textContent = 'Generating...';
        }

        // Add to history
        this.chatHistory.push({ role: 'user', content: message });

        // Create placeholder for assistant response
        const assistantMessageDiv = this.addOmniChatMessage('assistant', '▌');
        const textSpan = assistantMessageDiv?.querySelector('.message-text');
        let fullText = '';
        let audioData = null;
        let audioFormat = 'audio/wav';

        try {
            const response = await fetch('/api/omni/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: this.chatHistory,
                    temperature: 0.7,
                    max_tokens: 512,
                    stream: true
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Chat request failed');
            }

            // Handle streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);

                            // Handle text content
                            if (parsed.text) {
                                fullText += parsed.text;
                                if (textSpan) {
                                    textSpan.textContent = fullText + '▌';
                                }
                            }

                            // Handle audio content (usually at the end)
                            if (parsed.audio) {
                                audioData = parsed.audio;
                                audioFormat = parsed.audio_format || 'audio/wav';
                            }

                            // Handle error
                            if (parsed.error) {
                                throw new Error(parsed.error);
                            }
                        } catch (e) {
                            if (e.message !== 'Unexpected end of JSON input') {
                                console.warn('Parse error:', e);
                            }
                        }
                    }
                }
            }

            // Update final message
            if (textSpan) {
                textSpan.textContent = fullText || 'No response received';
            }

            // Add audio player if audio was returned
            if (audioData && assistantMessageDiv) {
                const audioContainer = document.createElement('div');
                audioContainer.className = 'chat-audio-response';
                audioContainer.innerHTML = `<audio controls src="data:${audioFormat};base64,${audioData}" class="chat-inline-audio"></audio>`;
                assistantMessageDiv.querySelector('.message-body')?.appendChild(audioContainer);
            }

            // Add to chat history
            this.chatHistory.push({ role: 'assistant', content: fullText });

        } catch (error) {
            console.error('Omni chat error:', error);
            if (textSpan) {
                textSpan.textContent = `Error: ${error.message}`;
            }
            this.ui.showNotification(`Chat error: ${error.message}`, 'error');
        } finally {
            // Re-enable send button
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send';
            }
        }
    },

    addOmniChatMessage(role, content, media = null) {
        const container = document.getElementById('omni-chat-container');
        if (!container) return null;

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}`;

        let html = '<div class="message-content">';

        // Avatar
        if (role !== 'system') {
            html += `<div class="message-avatar">${role === 'user' ? 'U' : 'AI'}</div>`;
        }

        // Content wrapper
        html += '<div class="message-body">';

        // Text content
        if (content) {
            html += `<span class="message-text">${this.escapeHtml(content)}</span>`;
        }

        // Media content (image, audio)
        if (media) {
            if (media.type === 'image') {
                html += `<img src="data:image/png;base64,${media.data}" class="chat-inline-image" alt="Generated image">`;
            } else if (media.type === 'audio') {
                const format = media.format || 'audio/wav';
                html += `<audio controls src="data:${format};base64,${media.data}" class="chat-inline-audio"></audio>`;
            }
        }

        html += '</div></div>';

        messageDiv.innerHTML = html;
        container.appendChild(messageDiv);

        // Auto-scroll
        container.scrollTop = container.scrollHeight;

        // Return the message div for streaming updates
        return messageDiv;
    },

    clearChat() {
        const container = document.getElementById('omni-chat-container');
        if (container) {
            // Keep only the system welcome message
            container.innerHTML = `
                <div class="chat-message system">
                    <div class="message-content">
                        <span class="message-text">Chat with Qwen-Omni. Supports text, images, and audio input/output.</span>
                    </div>
                </div>
            `;
        }
        // Clear chat history
        this.chatHistory = [];
        this.ui.showNotification('Chat cleared', 'info');
    },

    exportChat() {
        if (this.chatHistory.length === 0) {
            this.ui.showNotification('No chat history to export', 'warning');
            return;
        }

        // Format chat history for export
        const exportData = {
            timestamp: new Date().toISOString(),
            model: 'vLLM-Omni',
            messages: this.chatHistory
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `omni-chat-${Date.now()}.json`;
        link.click();

        URL.revokeObjectURL(url);
        this.ui.showNotification('Chat exported', 'success');
    },

    // =========================================================================
    // Logging
    // =========================================================================

    addLog(message) {
        const container = document.getElementById('omni-logs-container');
        if (!container) return;

        // Check for startup completion messages to trigger health check polling
        // vLLM-Omni shows "Uvicorn running" or "Application startup complete" when server is starting
        if (message && this.serverRunning && !this.serverReady && !this.healthCheckInterval) {
            if (message.includes('Uvicorn running') ||
                message.includes('Application startup complete') ||
                message.includes('Started server process')) {
                console.log('🔄 vLLM-Omni server starting, beginning health check polling...');
                this.startHealthCheckPolling();
            }
        }

        // Auto-detect log type for styling
        let logType = 'info';
        if (message) {
            const lowerMsg = message.toLowerCase();
            if (lowerMsg.includes('error') || lowerMsg.includes('failed') || lowerMsg.includes('exception')) {
                logType = 'error';
            } else if (lowerMsg.includes('warning') || lowerMsg.includes('warn')) {
                logType = 'warning';
            } else if (lowerMsg.includes('success') || lowerMsg.includes('ready') || lowerMsg.includes('complete')) {
                logType = 'success';
            }
        }

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${logType}`;

        const timestamp = new Date().toLocaleTimeString();
        logEntry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> ${this.escapeHtml(message)}`;

        container.appendChild(logEntry);

        // Auto-scroll if enabled
        const autoScroll = document.getElementById('omni-auto-scroll');
        if (autoScroll?.checked) {
            container.scrollTop = container.scrollHeight;
        }

        // Limit log entries to prevent memory issues
        const maxLogs = 500;
        const logs = container.querySelectorAll('.log-entry');
        if (logs.length > maxLogs) {
            logs[0].remove();
        }
    },

    clearLogs() {
        const container = document.getElementById('omni-logs-container');
        if (container) {
            container.innerHTML = '<div class="log-entry info">Logs cleared.</div>';
        }
        this.ui.showNotification('Logs cleared', 'info');
    },

    saveLogs() {
        const container = document.getElementById('omni-logs-container');
        if (!container) return;

        // Get all log entries as text
        const logEntries = container.querySelectorAll('.log-entry');
        if (logEntries.length === 0) {
            this.ui.showNotification('No logs to save', 'warning');
            return;
        }

        // Build log text
        const logLines = [];
        logEntries.forEach(entry => {
            logLines.push(entry.textContent);
        });

        const logText = logLines.join('\n');

        // Create and download file
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `vllm-omni-logs-${Date.now()}.txt`;
        link.click();

        URL.revokeObjectURL(url);
        this.ui.showNotification('Logs saved successfully', 'success');
    },

    toggleLogsRow() {
        const logsRow = document.getElementById('omni-logs-row');
        if (!logsRow) return;
        logsRow.classList.toggle('collapsed');
    },

    // =========================================================================
    // Resize Functionality
    // =========================================================================

    initResize() {
        const resizeHandle = document.getElementById('omni-config-resize-handle');
        if (!resizeHandle) return;

        resizeHandle.addEventListener('mousedown', (e) => this.startResize(e));
        document.addEventListener('mousemove', (e) => this.doResize(e));
        document.addEventListener('mouseup', () => this.stopResize());
    },

    startResize(e) {
        e.preventDefault();
        this.isResizing = true;
        this.resizeStartX = e.clientX;

        const configPanel = document.getElementById('omni-config-panel');
        this.resizeStartWidth = configPanel.offsetWidth;

        // Add visual feedback
        document.body.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    },

    doResize(e) {
        if (!this.isResizing) return;

        e.preventDefault();

        const deltaX = e.clientX - this.resizeStartX;
        let newWidth = this.resizeStartWidth + deltaX;

        // Clamp width between min and max
        const minWidth = 280;
        const maxWidth = 600;
        newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

        const configPanel = document.getElementById('omni-config-panel');
        if (configPanel) {
            configPanel.style.width = `${newWidth}px`;
            configPanel.style.flexShrink = '0';
        }
    },

    stopResize() {
        if (!this.isResizing) return;

        this.isResizing = false;
        document.body.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    },

    // =========================================================================
    // Utility Methods
    // =========================================================================

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
