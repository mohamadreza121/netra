import { labs, domains, commandReference } from './catalog.mjs';
import { concepts } from './concepts.mjs';
import { openAtStep } from './engine.mjs';
import { mountWireless } from './wireless-ui.mjs';
import { mountPractice } from '../practice/workspace.mjs';

mountPractice({
  tracks:[{id:'ccna', initial:'ospf', labs, domains, commandReference, concepts}],
  openSession:openAtStep,
  onWireless:mountWireless
});
