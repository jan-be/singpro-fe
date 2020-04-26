import * as timeSyncClient from "timesync/lib/timesync";
import { apiUrl } from "../GlobalConsts";

console.log("timeSyncClient.create")
const timeSyncClientI = timeSyncClient.create({
  server: `${apiUrl}/timesync`,
  delay: 100,
  interval: 60000,
});

export default timeSyncClientI
