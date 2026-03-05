import { Routes, Route } from "react-router-dom"
import Layout from "./components/Layout"
import AuthGuard from "./components/AuthGuard"
import AuthOnly from "./components/AuthOnly"
import Home from "./pages/Home"
import Register from "./pages/Register"
import Listings from "./pages/Listings"
import NewListing from "./pages/NewListing"
import ListingDetail from "./pages/ListingDetail"
import EditListing from "./pages/EditListing"
import ChatThread from "./pages/ChatThread"
import Messages from "./pages/Messages"
import QualityGate from "./pages/QualityGate"

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="register" element={<AuthOnly />}>
          <Route index element={<Register />} />
        </Route>
        <Route element={<AuthGuard />}>
          <Route path="listings" element={<Listings />} />
          <Route path="listings/new" element={<NewListing />} />
          <Route path="listings/:id" element={<ListingDetail />} />
          <Route path="listings/:id/edit" element={<EditListing />} />
          <Route path="messages" element={<Messages />} />
          <Route path="chat/:id" element={<ChatThread />} />
          <Route path="quality-gate" element={<QualityGate />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
