// The action catalog, published to the `meta` table as JSON tool schemas.
// The harness hands these to models unchanged; `submitDecision` validates
// whatever comes back. Add an action here and in `applyAction` together.
export const TOOLS = [
  {
    name: 'move_to',
    description:
      'Walk to a point on the map. You keep walking until you arrive or choose another action.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Tile x, 0 to map width' },
        y: { type: 'number', description: 'Tile y, 0 to map height' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'follow',
    description: 'Keep walking behind another agent until you choose another action.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer', description: 'id of the agent to follow' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'say',
    description: 'Say something out loud. Everyone within 8 tiles hears it.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 200 } },
      required: ['text'],
    },
  },
  {
    name: 'idle',
    description: 'Stop and wait.',
    parameters: { type: 'object', properties: {} },
  },
];
