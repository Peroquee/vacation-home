import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type Column<Row> = {
  /** Stable identifier, used as the React key. */
  id: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  /** Right-align numbers and money so their digits line up. */
  align?: "start" | "end";
  className?: string;
};

type DataTableProps<Row> = {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Rendered instead of the table when `rows` is empty. */
  empty: React.ReactNode;
  /** Describes the table for screen readers; visually hidden. */
  caption: string;
  className?: string;
};

/**
 * A read-only table over a list of rows. Not a client component, so a server
 * component can pass `cell` functions straight in; sorting, filtering and
 * pagination belong in the URL and the query, not here.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <Table className={className}>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.id}
              scope="col"
              className={cn(column.align === "end" && "text-right", column.className)}
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell
                key={column.id}
                className={cn(
                  column.align === "end" && "text-right tabular-nums",
                  column.className,
                )}
              >
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
