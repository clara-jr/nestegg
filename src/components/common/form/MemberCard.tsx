export interface MemberCardProps {
  index: number;
  totalMembers: number;
  onRemove?: () => void;
  children: React.ReactNode;
}

export function MemberCard({ index, totalMembers, onRemove, children }: Readonly<MemberCardProps>) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
      {totalMembers > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-900 uppercase tracking-wider">
            Integrante {index + 1}
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-red-600 hover:text-red-800 cursor-pointer"
              title="Eliminar integrante"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
