// The action catalog, published to the `meta` table as JSON tool schemas.
// The harness hands these to models unchanged; `applyAction` validates
// whatever comes back. Add an action here and in actions.ts together.

const ITEM = { type: 'string', enum: ['berries', 'ration', 'wood'] };
const QTY = { type: 'integer', minimum: 1, description: 'How many (default 1)' };

export const TOOLS = [
  {
    name: 'move_to',
    description: 'Walk to a point on the map. You keep walking until you arrive or choose another action.',
    parameters: {
      type: 'object',
      properties: { x: { type: 'number', description: 'Tile x' }, y: { type: 'number', description: 'Tile y' } },
      required: ['x', 'y'],
    },
  },
  {
    name: 'follow',
    description: 'Keep walking behind another survivor until you choose another action.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer', description: 'id of the survivor to follow' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'gather',
    description:
      'Walk to a berry bush or tree and keep picking berries or chopping wood until it is empty or your hands are full.',
    parameters: {
      type: 'object',
      properties: { node_id: { type: 'integer', description: 'id of the bush or tree' } },
      required: ['node_id'],
    },
  },
  {
    name: 'eat',
    description: 'Eat one berry or one ration you are carrying.',
    parameters: {
      type: 'object',
      properties: { item: { type: 'string', enum: ['berries', 'ration'] } },
      required: ['item'],
    },
  },
  {
    name: 'take',
    description: 'Take items out of a container you are standing next to (a chest, the plane wreck, or dropped things).',
    parameters: {
      type: 'object',
      properties: { container_id: { type: 'integer' }, item: ITEM, qty: QTY },
      required: ['container_id', 'item'],
    },
  },
  {
    name: 'store',
    description: 'Put items you are carrying into a container you are standing next to.',
    parameters: {
      type: 'object',
      properties: { container_id: { type: 'integer' }, item: ITEM, qty: QTY },
      required: ['container_id', 'item'],
    },
  },
  {
    name: 'give',
    description: 'Hand items you are carrying to a survivor standing next to you.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer' }, item: ITEM, qty: QTY },
      required: ['agent_id', 'item'],
    },
  },
  {
    name: 'feed_fire',
    description:
      'Add wood you are carrying to a fire within reach. Each wood burns 30 seconds. The signal fire needs 15 wood before it can be lit; once burning, search planes can see it at night.',
    parameters: {
      type: 'object',
      properties: { structure_id: { type: 'integer' }, qty: QTY },
      required: ['structure_id'],
    },
  },
  {
    name: 'attack',
    description: 'Go after another survivor and keep hitting them until they are knocked out or you choose another action.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer' } },
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
