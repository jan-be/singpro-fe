import * as timeSyncClient from "timesync/lib/timesync";
import { apiDomain } from "../GlobalConsts";

console.log("timeSyncClient.create")
const timeSyncClientI = timeSyncClient.create({
  server: `https://${apiDomain}/timesync`,
  delay: 100,
  interval: 60000,
});

export default timeSyncClientI
