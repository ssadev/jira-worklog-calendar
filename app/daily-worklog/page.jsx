import { Suspense } from "react";
import DailyWorklogView from "@/components/daily-worklog-view";

export const metadata = {
  title: "Daily Worklog",
};

export default function DailyWorklogPage() {
  return (
    <Suspense>
      <DailyWorklogView />
    </Suspense>
  );
}
