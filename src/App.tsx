import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import SiteAnalytics from "@/components/SiteAnalytics";
import "./pages/app-entry.css";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";

import { rootAuthDestination } from "./lib/authCallback";
function HomeRoute() {
  const location = useLocation();
  const destination = rootAuthDestination(location.pathname, location.search, location.hash);
  return destination ? <Navigate to={destination} replace /> : <Landing />;
}
const TestimonialPreview = import.meta.env.DEV && import.meta.env.VITE_SHOW_TESTIMONIAL_PREVIEW === "true" ? lazy(() => import("./pages/TestimonialPreview")) : null;
const BookApp = lazy(() => import("./pages/BookApp"));
const MyBooksFixture = lazy(() => import("./pages/MyBooksFixture"));
const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <SiteAnalytics />
      <Sonner />

        <BrowserRouter>
          <Routes>
            {TestimonialPreview && <Route path="/design-preview" element={<Suspense fallback={<p role="status">Opening preview...</p>}><TestimonialPreview /></Suspense>} /> }
            <Route path="/" element={<HomeRoute />} />
            <Route
              path="/app"
              element={(
                <Suspense fallback={<p role="status" className="p-8 text-center">Opening your books...</p>}><BookApp /></Suspense>
              )}
            />
            <Route path="/dev/my-books-fixture" element={<Suspense fallback={<p role="status">Loading fixture...</p>}><MyBooksFixture /></Suspense>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>

    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
