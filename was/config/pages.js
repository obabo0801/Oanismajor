import { map } from "#config/html";
import * as path from "#config/path";

const load = () => JSON.parse(path.readFileSync(path.dist(map), "utf8"));

export default (name) => path.dist(load()[name]);
