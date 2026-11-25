import { AdminScreen } from "@/features/admin/AdminScreen";
import { AnalyticsPeriodProvider } from "@/features/analytics/analytics-period";
export default function AdminRoute() {
    return (
        <AnalyticsPeriodProvider>
            <AdminScreen />
        </AnalyticsPeriodProvider>
    );
}
