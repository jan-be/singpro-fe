import React from "react";
import Footer from "../components/Footer";
import { Link } from "react-router-dom";
import Wordmark from "../components/Wordmark";
import AccountMenu from "../components/AccountMenu";
import AdminLink from "../components/AdminLink";

const WrapperPage = props => {
  return (
    <div className="flex flex-col min-h-screen overflow-x-clip">
      <nav className="bg-ink/70 backdrop-blur-md border-b border-white/[0.06] relative z-40">
        <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center no-underline transition-colors">
            <Wordmark height={38} className="-my-1.5" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <AdminLink />
            <AccountMenu />
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl xl:max-w-5xl 2xl:max-w-6xl w-full mx-auto px-4 py-10">
        {props.children}
      </main>

      {!props.hideFooter && <Footer />}
    </div>
  );
};

export default WrapperPage;
