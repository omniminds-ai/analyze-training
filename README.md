# Viralmind Data Pipeline

Use the Viralmind data pipeline to gather information about data collected with the Viralmind training gym.

## Input Data Format

The pipeline expects input data in one of these formats:

1. Gym Desktop recordings:

   - `session_id.mp4` - The video recording
   - `session_id.events.jsonl` - Event data in JSONL format
   - `session_id.meta.json` - Optional metadata about the recording

2. Gym Web recordings:
   - `session_id.events.json` - Event data
   - `session_id.guac` - Guacamole recording file
   - `session_id.guac.m4v` - Video recording

## Usage

You can run the pipeline in two ways:

1. Original format with separate data, sessions, and output directories:

```bash
bun run src/index.ts -o output_dir -f web -s session_id1,session_id2 -d data_directory
bun run src/index.ts -o output_dir -f desktop -i 20250211_215443 -d data
```

2. Simplified format using the current directory:

```bash
cd path/to/session_directory
bun run src/index.ts -f desktop -i .
```

### Arguments

- `-o, --output`: Directory to save processed output
- `-f, --format`: Format of the input data. Either `web` or `desktop`.
- `-s, --sessions`: Comma-separated list of session IDs to process
- `-d, --data`: Directory containing the input data files
- `-i, --input`: Session directory to process. The parent directory will be used as both data and output directory.
