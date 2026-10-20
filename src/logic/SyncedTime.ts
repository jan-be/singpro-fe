import * as timeSyncClient from "timesync/lib/timesync";
import { apiUrl } from "../GlobalConsts";

const timeSyncClientI = timeSyncClient.create({
  server: `${apiUrl}/timesync`,
  delay: 100,
  interval: 60000,
});

export default timeSyncClientI
