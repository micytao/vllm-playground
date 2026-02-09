import Foundation

// MARK: - Prompt Template

struct PromptTemplate: Identifiable {
    let id: String
    let name: String
    let icon: String
    let prompt: String
    let negativePrompt: String
}

struct TTSTemplate: Identifiable {
    let id: String
    let name: String
    let icon: String
    let text: String
}

// MARK: - Image Generation Templates

enum ImagePromptTemplates {
    static let landscapes: [PromptTemplate] = [
        PromptTemplate(
            id: "landscape-sunset",
            name: "Sunset",
            icon: "sun.horizon.fill",
            prompt: "Beautiful sunset over ocean waves, vibrant orange and purple sky, golden hour lighting, photorealistic, 4k, detailed clouds, calm waters reflecting the sky",
            negativePrompt: "blurry, low quality, artifacts, oversaturated, cartoon, painting"
        ),
        PromptTemplate(
            id: "landscape-mountain",
            name: "Mountain",
            icon: "mountain.2.fill",
            prompt: "Majestic snow-capped mountain peaks at golden hour, crystal clear alpine lake reflection, dramatic clouds, professional nature photography, 8k resolution",
            negativePrompt: "blurry, artificial, cartoon, drawing, oversaturated, people"
        ),
        PromptTemplate(
            id: "landscape-forest",
            name: "Forest",
            icon: "tree.fill",
            prompt: "Enchanted misty forest with sunbeams filtering through ancient trees, moss-covered ground, magical atmosphere, ethereal lighting, fantasy landscape",
            negativePrompt: "blurry, dark, muddy colors, artificial, low quality"
        ),
    ]

    static let portraits: [PromptTemplate] = [
        PromptTemplate(
            id: "portrait-professional",
            name: "Professional",
            icon: "person.crop.rectangle",
            prompt: "Professional business headshot, confident expression, soft studio lighting, shallow depth of field, clean background, high-end corporate photography",
            negativePrompt: "blurry, distorted face, extra fingers, deformed, amateur, harsh lighting"
        ),
        PromptTemplate(
            id: "portrait-artistic",
            name: "Artistic",
            icon: "paintpalette.fill",
            prompt: "Artistic portrait with dramatic lighting, Rembrandt style, emotional expression, fine art photography, rich shadows and highlights, cinematic mood",
            negativePrompt: "blurry, flat lighting, distorted features, low quality, amateur"
        ),
        PromptTemplate(
            id: "portrait-fantasy",
            name: "Fantasy",
            icon: "sparkles",
            prompt: "Fantasy character portrait, elven features, ethereal beauty, flowing silver hair, glowing eyes, ornate jewelry, magical aura, detailed fantasy art",
            negativePrompt: "blurry, bad anatomy, extra limbs, distorted face, low quality"
        ),
    ]

    static let artStyles: [PromptTemplate] = [
        PromptTemplate(
            id: "art-abstract",
            name: "Abstract",
            icon: "circle.hexagongrid.fill",
            prompt: "Abstract fluid art, vibrant swirling colors, dynamic composition, modern art style, blue and gold palette, high contrast, artistic masterpiece",
            negativePrompt: "blurry, muddy colors, low contrast, boring, simple"
        ),
        PromptTemplate(
            id: "art-surreal",
            name: "Surreal",
            icon: "eye.trianglebadge.exclamationmark",
            prompt: "Surrealist dreamscape, melting clocks, floating objects, impossible architecture, Salvador Dali inspired, vivid imagination, otherworldly atmosphere",
            negativePrompt: "blurry, realistic, mundane, boring, low quality"
        ),
        PromptTemplate(
            id: "art-cyberpunk",
            name: "Cyberpunk",
            icon: "building.2.fill",
            prompt: "Cyberpunk city at night, neon lights reflecting on wet streets, flying cars, holographic advertisements, futuristic architecture, rain, atmospheric",
            negativePrompt: "blurry, daytime, nature, low quality, simple"
        ),
    ]

    static let nature: [PromptTemplate] = [
        PromptTemplate(
            id: "nature-wildlife",
            name: "Wildlife",
            icon: "pawprint.fill",
            prompt: "Majestic lion in African savanna, golden hour lighting, professional wildlife photography, detailed fur, intense gaze, natural habitat, National Geographic style",
            negativePrompt: "blurry, cartoon, artificial, zoo, low quality"
        ),
        PromptTemplate(
            id: "nature-flowers",
            name: "Flowers",
            icon: "camera.macro",
            prompt: "Beautiful flower garden in full bloom, macro photography, morning dew on petals, vibrant colors, soft bokeh background, botanical beauty",
            negativePrompt: "blurry, wilted, artificial, low quality, oversaturated"
        ),
        PromptTemplate(
            id: "nature-underwater",
            name: "Underwater",
            icon: "water.waves",
            prompt: "Vibrant coral reef underwater scene, tropical fish, crystal clear water, sunbeams penetrating the surface, marine life photography, colorful sea creatures",
            negativePrompt: "blurry, murky water, low quality, artificial"
        ),
    ]

    static let products: [PromptTemplate] = [
        PromptTemplate(
            id: "product-tech",
            name: "Tech",
            icon: "iphone",
            prompt: "Sleek modern smartphone on reflective surface, studio lighting, minimalist background, product photography, sharp details, professional commercial shot",
            negativePrompt: "blurry, cluttered, amateur, low quality, dirty"
        ),
        PromptTemplate(
            id: "product-food",
            name: "Food",
            icon: "fork.knife",
            prompt: "Gourmet dish on elegant plate, professional food photography, appetizing presentation, fresh ingredients, soft natural lighting, restaurant quality",
            negativePrompt: "blurry, unappetizing, messy, low quality, artificial"
        ),
    ]

    static let allCategories: [(name: String, templates: [PromptTemplate])] = [
        ("Landscapes", landscapes),
        ("Portraits", portraits),
        ("Art & Abstract", artStyles),
        ("Nature", nature),
        ("Products", products),
    ]
}

// MARK: - Audio Generation Templates

enum AudioPromptTemplates {
    static let music: [PromptTemplate] = [
        PromptTemplate(
            id: "audio-ambient",
            name: "Ambient",
            icon: "moon.stars.fill",
            prompt: "Calm ambient music, soft synthesizer pads, relaxing atmosphere, gentle melody, meditation music, peaceful and soothing",
            negativePrompt: "loud, harsh, aggressive, fast tempo, vocals, distorted"
        ),
        PromptTemplate(
            id: "audio-piano",
            name: "Piano",
            icon: "pianokeys",
            prompt: "Beautiful piano melody, emotional and touching, classical style, soft dynamics, clear notes, concert hall acoustics",
            negativePrompt: "harsh, distorted, electronic, loud, fast, aggressive"
        ),
        PromptTemplate(
            id: "audio-electronic",
            name: "Electronic",
            icon: "beats.headphones",
            prompt: "Modern electronic beat, punchy drums, deep bass, catchy synth melody, dance music, energetic and uplifting",
            negativePrompt: "acoustic, slow, boring, muddy, distorted, no rhythm"
        ),
    ]

    static let natureSounds: [PromptTemplate] = [
        PromptTemplate(
            id: "audio-rain",
            name: "Rain",
            icon: "cloud.rain.fill",
            prompt: "Gentle rain falling on window, distant thunder, cozy atmosphere, relaxing rain sounds, peaceful ambiance for sleep",
            negativePrompt: "heavy storm, loud, harsh, sudden sounds, music"
        ),
        PromptTemplate(
            id: "audio-forest",
            name: "Forest",
            icon: "leaf.fill",
            prompt: "Forest ambiance with birds singing, gentle breeze through leaves, distant stream, peaceful nature sounds, immersive environment",
            negativePrompt: "loud, urban sounds, music, harsh, artificial"
        ),
        PromptTemplate(
            id: "audio-ocean",
            name: "Ocean",
            icon: "water.waves",
            prompt: "Ocean waves gently crashing on beach, seagulls in distance, relaxing coastal sounds, peaceful seaside ambiance",
            negativePrompt: "storm, loud, harsh, music, artificial, sudden sounds"
        ),
    ]

    static let soundEffects: [PromptTemplate] = [
        PromptTemplate(
            id: "audio-whoosh",
            name: "Whoosh",
            icon: "wind",
            prompt: "Smooth swoosh sound effect, clean and professional, cinematic transition sound, fast movement audio, modern UI sound",
            negativePrompt: "harsh, distorted, long, music, vocals"
        ),
        PromptTemplate(
            id: "audio-impact",
            name: "Impact",
            icon: "bolt.fill",
            prompt: "Deep cinematic impact sound, powerful and dramatic, movie trailer style, bass-heavy hit, professional sound design",
            negativePrompt: "weak, thin, long, music, vocals, distorted"
        ),
        PromptTemplate(
            id: "audio-notification",
            name: "Chime",
            icon: "bell.fill",
            prompt: "Pleasant notification chime, clear and melodic, friendly UI sound, short and recognizable, modern app notification",
            negativePrompt: "harsh, annoying, long, complex, music, distorted"
        ),
    ]

    static let ambiance: [PromptTemplate] = [
        PromptTemplate(
            id: "audio-cafe",
            name: "Cafe",
            icon: "cup.and.saucer.fill",
            prompt: "Coffee shop ambiance, gentle background chatter, clinking cups, espresso machine sounds, cozy atmosphere, work-friendly background",
            negativePrompt: "loud, music, harsh, clear speech, empty, silence"
        ),
        PromptTemplate(
            id: "audio-city",
            name: "City",
            icon: "building.2.fill",
            prompt: "Urban city background sounds, distant traffic, pedestrians walking, city life ambiance, daytime urban atmosphere",
            negativePrompt: "quiet, nature, music, harsh, isolated sounds"
        ),
        PromptTemplate(
            id: "audio-space",
            name: "Space",
            icon: "sparkles",
            prompt: "Deep space ambiance, mysterious cosmic sounds, ethereal drone, sci-fi atmosphere, otherworldly and immersive",
            negativePrompt: "music, harsh, loud, earth sounds, vocals"
        ),
    ]

    static let allCategories: [(name: String, templates: [PromptTemplate])] = [
        ("Music", music),
        ("Nature Sounds", natureSounds),
        ("Sound Effects", soundEffects),
        ("Ambiance", ambiance),
    ]
}

// MARK: - TTS Templates

enum TTSPresetTemplates {
    static let introductions: [TTSTemplate] = [
        TTSTemplate(
            id: "tts-playground-intro",
            name: "Playground Intro",
            icon: "sparkles",
            text: "Welcome to vLLM Playground! I am your AI assistant, powered by vLLM and vLLM-Omni. This playground allows you to experiment with state-of-the-art language models, generate stunning images, create videos, and synthesize natural-sounding speech like this."
        ),
        TTSTemplate(
            id: "tts-welcome",
            name: "Welcome",
            icon: "hand.wave.fill",
            text: "Hello and welcome! Thank you for using our text-to-speech service. I can help you convert any text into natural, human-like speech. Feel free to type anything you would like me to say."
        ),
        TTSTemplate(
            id: "tts-demo",
            name: "TTS Demo",
            icon: "waveform",
            text: "This is a demonstration of the text-to-speech model. Notice how the speech flows naturally, with appropriate pauses, intonation, and rhythm. The model can handle various types of content, from conversational dialogue to formal announcements."
        ),
    ]

    static let professional: [TTSTemplate] = [
        TTSTemplate(
            id: "tts-news",
            name: "News",
            icon: "newspaper.fill",
            text: "Good evening. In today's top stories: Researchers have made significant breakthroughs in artificial intelligence, with new models demonstrating unprecedented capabilities in language understanding and generation. Meanwhile, tech companies continue to invest heavily in AI infrastructure."
        ),
        TTSTemplate(
            id: "tts-presentation",
            name: "Presentation",
            icon: "person.and.background.dotted",
            text: "Good morning everyone, and thank you for joining today's presentation. We have an exciting agenda ahead of us, covering the latest developments in our field. I'll be walking you through the key findings and their implications for our work going forward."
        ),
        TTSTemplate(
            id: "tts-tutorial",
            name: "Tutorial",
            icon: "book.fill",
            text: "In this tutorial, we'll walk through the process step by step. First, make sure you have all the necessary prerequisites installed. Then, follow along as I guide you through each stage of the setup."
        ),
    ]

    static let creative: [TTSTemplate] = [
        TTSTemplate(
            id: "tts-story",
            name: "Story",
            icon: "text.book.closed.fill",
            text: "Once upon a time, in a land far away, there lived a curious inventor who dreamed of building machines that could think and speak. Day after day, she worked in her workshop, combining gears and circuits until one morning, her creation spoke its first words."
        ),
        TTSTemplate(
            id: "tts-podcast",
            name: "Podcast",
            icon: "mic.fill",
            text: "Hey everyone, welcome back to the show! I'm your host, and today we have an incredible episode lined up for you. We're going to dive deep into some fascinating topics that I know you're going to love. So grab your coffee, get comfortable, and let's get into it!"
        ),
    ]

    static let allCategories: [(name: String, templates: [TTSTemplate])] = [
        ("Introductions", introductions),
        ("Professional", professional),
        ("Creative", creative),
    ]
}

// MARK: - Video Prompt Templates

enum VideoPromptTemplates {
    static let nature: [PromptTemplate] = [
        PromptTemplate(id: "vid-ocean", name: "Ocean", icon: "water.waves", prompt: "Cinematic ocean waves crashing on a rocky shore at golden hour, dramatic lighting, slow motion water spray, aerial drone shot", negativePrompt: "blurry, low quality, distorted, text, watermark"),
        PromptTemplate(id: "vid-forest", name: "Forest", icon: "tree.fill", prompt: "Smooth walking through an enchanted forest with sunlight filtering through ancient trees, misty atmosphere, cinematic movement", negativePrompt: "blurry, shaky, low quality, distorted"),
        PromptTemplate(id: "vid-clouds", name: "Clouds", icon: "cloud.fill", prompt: "Timelapse of dramatic clouds moving across a colorful sky at sunset, golden and purple hues, ultra high definition", negativePrompt: "static, boring, low quality, pixelated"),
    ]

    static let action: [PromptTemplate] = [
        PromptTemplate(id: "vid-running", name: "Running", icon: "figure.run", prompt: "Athletic person running in slow motion through a city at dawn, dramatic backlit silhouette, cinematic depth of field", negativePrompt: "blurry, distorted face, low quality, unnatural movement"),
        PromptTemplate(id: "vid-dancing", name: "Dancing", icon: "figure.dance", prompt: "Graceful dancer performing ballet in an empty studio with dramatic spotlight, flowing movements, slow motion", negativePrompt: "blurry, distorted limbs, low quality, jerky motion"),
        PromptTemplate(id: "vid-sports", name: "Sports", icon: "sportscourt.fill", prompt: "Basketball player making a dramatic slam dunk in slow motion, crowd cheering, dynamic camera angle, cinematic lighting", negativePrompt: "blurry, distorted, low quality, static"),
    ]

    static let urban: [PromptTemplate] = [
        PromptTemplate(id: "vid-cityscape", name: "Cityscape", icon: "building.2.fill", prompt: "Timelapse of a modern city skyline transitioning from day to night, lights turning on, busy traffic below", negativePrompt: "blurry, low quality, distorted buildings, flickering"),
        PromptTemplate(id: "vid-traffic", name: "Traffic", icon: "car.fill", prompt: "Smooth traffic flow on a highway at dusk with light trails, aerial view, cinematic color grading", negativePrompt: "blurry, jerky, low quality, overexposed"),
        PromptTemplate(id: "vid-neon", name: "Neon City", icon: "sparkle", prompt: "Walking through neon-lit cyberpunk streets at night, rain reflections on wet pavement, atmospheric fog", negativePrompt: "blurry, distorted text, low quality, static"),
    ]

    static let animals: [PromptTemplate] = [
        PromptTemplate(id: "vid-bird", name: "Eagle", icon: "bird.fill", prompt: "Majestic eagle soaring through a clear blue sky with mountains below, cinematic tracking shot, ultra high definition", negativePrompt: "blurry, distorted wings, low quality, static"),
        PromptTemplate(id: "vid-cat", name: "Cat", icon: "cat.fill", prompt: "Cute cat playing with a toy in a sunny living room, natural movement, shallow depth of field, warm tones", negativePrompt: "blurry, distorted, unnatural, low quality"),
        PromptTemplate(id: "vid-fish", name: "Underwater", icon: "fish.fill", prompt: "Colorful tropical fish swimming in a vibrant coral reef, underwater cinematography, crystal clear water", negativePrompt: "blurry, murky water, low quality, distorted"),
    ]

    static let abstract: [PromptTemplate] = [
        PromptTemplate(id: "vid-particles", name: "Particles", icon: "sparkles", prompt: "Abstract particle system flowing and swirling in deep space, bioluminescent colors, smooth motion, 4K quality", negativePrompt: "blurry, static, low quality, boring"),
        PromptTemplate(id: "vid-liquid", name: "Liquid", icon: "drop.fill", prompt: "Abstract liquid metal morphing and flowing in slow motion, reflective chrome surface, dramatic studio lighting", negativePrompt: "blurry, static, low quality, pixelated"),
        PromptTemplate(id: "vid-shapes", name: "Geometry", icon: "cube.fill", prompt: "Geometric shapes smoothly morphing into each other with neon glow effects, dark background, satisfying transitions", negativePrompt: "blurry, jerky, low quality, boring"),
    ]

    static let allCategories: [(name: String, templates: [PromptTemplate])] = [
        ("Nature & Scenery", nature),
        ("Action & Motion", action),
        ("Urban & City", urban),
        ("Animals", animals),
        ("Abstract & Creative", abstract),
    ]
}
