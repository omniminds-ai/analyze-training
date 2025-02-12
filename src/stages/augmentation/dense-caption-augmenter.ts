import { ProcessedEvent, PipelineStage } from '../../shared/types';
import OpenAI from 'openai';

export class DenseCaptionAugmenter implements PipelineStage<ProcessedEvent[], ProcessedEvent[]> {
    private openai: OpenAI;

    constructor(private maxSamples: number = 3) {
        this.openai = new OpenAI();
    }

    private async generateCaption(frame: string): Promise<string> {
        const prompt = `Provide a detailed description of the GUI screenshot, including all visible elements, layout, and styling. Focus on:
1. Layout structure and organization
2. Interactive elements (buttons, forms, etc.)
3. Visual styling and design elements
4. Content and text elements
5. Navigation elements if present`;

        const response = await this.openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${frame}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 500
        });

        return response.choices[0].message.content || '';
    }

    async process(events: ProcessedEvent[]): Promise<ProcessedEvent[]> {
        console.log('\n[DenseCaptionAugmenter] Starting dense caption generation...');
        
        // Get frame events
        const frameEvents = events.filter(e => e.type === 'frame');
        console.log(`[DenseCaptionAugmenter] Found ${frameEvents.length} total frames`);
        
        // Randomly sample frames up to maxSamples
        const indices = Array.from({length: frameEvents.length}, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        const sampledFrames = indices
            .slice(0, Math.min(this.maxSamples, frameEvents.length))
            .map(i => frameEvents[i]);
        console.log(`[DenseCaptionAugmenter] Selected ${sampledFrames.length} frames for captioning`);

        // Generate captions for sampled frames
        let completed = 0;
        for (const frameEvent of sampledFrames) {
            if (!frameEvent.data.frame) continue;

            try {
                console.log(`[DenseCaptionAugmenter] Processing frame ${++completed}/${sampledFrames.length} at timestamp ${frameEvent.timestamp}`);
                const caption = await this.generateCaption(frameEvent.data.frame);
                console.log(`[DenseCaptionAugmenter] Generated caption (${caption.length} chars)`);
                
                events.push({
                    type: 'dense_caption',
                    timestamp: frameEvent.timestamp,
                    data: {
                        frame: frameEvent.data.frame,
                        text: caption
                    }
                });
            } catch (error) {
                console.error(`[DenseCaptionAugmenter] Error generating caption for frame ${completed}:`, error);
            }
        }

        console.log(`[DenseCaptionAugmenter] Completed dense caption generation. Generated ${completed} captions.\n`);
        return events;
    }
}
