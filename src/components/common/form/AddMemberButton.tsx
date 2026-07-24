export interface AddMemberButtonProps {
  onClick: () => void;
  label?: string;
}

export function AddMemberButton({ onClick, label = '+ Añadir integrante' }: Readonly<AddMemberButtonProps>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm font-semibold text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-all"
    >
      {label}
    </button>
  );
}
