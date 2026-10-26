interface TradeWiseLogoProps {
  className?: string;
  iconOnly?: boolean;
}

export function TradeWiseLogo({ className = "", iconOnly = false }: TradeWiseLogoProps) {
  return (
    <span className={`tradewise-logo ${iconOnly ? "is-icon-only" : ""} ${className}`.trim()}>
      <svg
        aria-hidden="true"
        className="tradewise-logo-icon"
        fill="none"
        viewBox="0 0 48 48"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M6 8.5h28.5L40 14"
          stroke="#F5FAFF"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
        />
        <path d="M21.75 10v22" stroke="#F5FAFF" strokeLinecap="round" strokeWidth="3.5" />
        <path
          d="m6.5 22 7 15 7-10 6.5 8 13-17"
          stroke="#77D7FF"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
        />
        <path d="M33.5 18H40v6.5" stroke="#77D7FF" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />
      </svg>
      {!iconOnly && (
        <span className="tradewise-logo-wordmark">
          <span>Trade</span>
          <span>Wise</span>
        </span>
      )}
    </span>
  );
}
