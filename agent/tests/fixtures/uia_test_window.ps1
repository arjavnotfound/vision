# Off-screen, never-activated WinForms window with known buttons, for the click-by-name
# test. Prints its window handle, then logs each pressed button's name to $Log.
param([string]$Log)
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -IgnoreWarnings -TypeDefinition @"
using System.Windows.Forms;
public class QuietForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get {
        var p = base.CreateParams; p.ExStyle |= 0x08000080; return p; } } // NOACTIVATE | TOOLWINDOW
}
"@
$form = New-Object QuietForm
$form.Text = 'VISION UIA test'
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-4000, -4000)
$form.Size = New-Object System.Drawing.Size(500, 300)
$y = 5
foreach ($spec in @('Submit', 'Save draft', 'Save copy', 'Delete', 'Delete', 'Archive')) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $spec; $b.Top = $y; $b.Left = 5; $b.Width = 200; $y += 35
    if ($spec -eq 'Archive') { $b.Enabled = $false }
    $b.Add_Click({ param($s, $e) Add-Content -Path $Log -Value $s.Text })
    $form.Controls.Add($b)
}
$form.Add_Shown({ [Console]::Out.WriteLine("HWND " + $form.Handle.ToInt64()); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($form)
