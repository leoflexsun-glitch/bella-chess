import { runSearch } from './searcher.js';

self.onmessage = ({ data }) => {
	if (data.type !== 'search') return;
	self.postMessage(runSearch(data));
};
